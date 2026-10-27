"""Local Docker regression: gateway survives both API IPs changing, without restart.

Uses isolated disposable containers/network, no host ports, credentials or data volumes.
Run: python tests/gateway-dns-smoke.py
"""
import ipaddress
import json
import pathlib
import re
import subprocess
import tempfile
import time
import uuid

root = pathlib.Path(__file__).resolve().parents[1]
prefix = 'hackethos-dns-test-' + uuid.uuid4().hex[:8]
image = 'nginx:1.27.5-alpine'
containers = []
network_created = False

def docker(*args, check=True):
    result = subprocess.run(['docker', *args], capture_output=True, text=True, timeout=90)
    if check and result.returncode:
        raise RuntimeError(f'docker {args[0]} failed: {result.stderr.strip()}')
    return result

def probe(name):
    result = docker('exec', name, 'wget', '-T', '2', '-qO-', 'http://127.0.0.1:3000/health/', check=False)
    return result.stdout.strip() if result.returncode == 0 else 'unavailable'

with tempfile.TemporaryDirectory(prefix=prefix) as temporary:
    folder = pathlib.Path(temporary)
    try:
        (folder / '.env').write_text('COMPOSE_PROFILES=cache\nCACHE_REDIS_PASSWORD=local-validation-only\n')
        docker('compose', '--project-directory', str(folder), '--env-file', str(folder / '.env'), '-f', str(root / 'docker-compose.yml'), 'config', '--quiet')
        docker('image', 'inspect', image)
        docker('network', 'create', prefix)
        network_created = True
        subnet = json.loads(docker('network', 'inspect', prefix).stdout)[0]['IPAM']['Config'][0]['Subnet']
        network = ipaddress.ip_network(subnet)
        def start(name, address, config, alias=None):
            args = ['run', '-d', '--name', name, '--network', prefix, '--ip', str(network.network_address + address)]
            if alias:
                args += ['--network-alias', alias]
            args += ['--mount', f'type=bind,source={config},target=/etc/nginx/conf.d/default.conf,readonly', image]
            docker(*args)
            containers.append(name)

        def api(name, address, alias, body):
            config = folder / (name + '.conf')
            config.write_text(f'server {{ listen 3000; location / {{ return 200 "{body}"; }} }}\n')
            start(name, address, config, alias)

        old1, old2 = prefix + '-old1', prefix + '-old2'
        api(old1, 10, 'api-1', 'old-api-1')
        api(old2, 11, 'api-2', 'old-api-2')
        legacy_config = folder / 'legacy.conf'
        legacy_text = (root / 'nginx.conf').read_text()
        legacy_text = re.sub(r'^\s*(?:zone|resolver|resolver_timeout)\s+[^\n]+\n', '', legacy_text, flags=re.MULTILINE)
        legacy_config.write_text(legacy_text.replace(':3000 resolve ', ':3000 '))
        legacy, fixed = prefix + '-legacy', prefix + '-fixed'
        start(legacy, 20, legacy_config)
        start(fixed, 21, root / 'nginx.conf')
        docker('exec', fixed, 'nginx', '-t')
        deadline = time.monotonic() + 20
        for name in [legacy, fixed]:
            while probe(name) not in {'old-api-1', 'old-api-2'}:
                if time.monotonic() > deadline:
                    raise RuntimeError('Gateway initial readiness failed')
                time.sleep(0.5)
        identity = docker('inspect', '--format', '{{.Id}} {{.State.StartedAt}}', fixed).stdout.strip()
        for name in [old1, old2]:
            docker('rm', '-f', name)
            containers.remove(name)
        api(prefix + '-new1', 12, 'api-1', 'new-api-1')
        api(prefix + '-new2', 13, 'api-2', 'new-api-2')
        seen = set()
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline and seen != {'new-api-1', 'new-api-2'}:
            answer = probe(fixed)
            if answer.startswith('new-api-'):
                seen.add(answer)
            time.sleep(0.5)
        if seen != {'new-api-1', 'new-api-2'}:
            raise RuntimeError(f'Gateway failed to discover both new replicas: {seen}')
        if probe(legacy) != 'unavailable':
            raise RuntimeError('Legacy stale-address failure was not reproduced')
        if docker('inspect', '--format', '{{.Id}} {{.State.StartedAt}}', fixed).stdout.strip() != identity:
            raise RuntimeError('Gateway was unexpectedly recreated or restarted')
        print(json.dumps({'legacy_stale_ip_failure': 'reproduced', 'fixed_gateway': 'passed', 'new_replicas_seen': sorted(seen), 'gateway_restarted': False, 'production_touched': False}))
    finally:
        for name in reversed(containers):
            docker('rm', '-f', name, check=False)
        if network_created:
            docker('network', 'rm', prefix, check=False)
