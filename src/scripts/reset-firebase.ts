import fs from "fs/promises";
import path from "path";
import type { auth } from "firebase-admin";
import { DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { v2 as cloudinary } from "cloudinary";
import { firebaseAdmin, firebaseAuth, firestore } from "../config/firebase";
import { garageS3 } from "../config/garage";

type ScriptOptions = {
  execute: boolean;
  includeStorage: boolean;
  downloadStorage: boolean;
  includeGarage: boolean;
  includeCloudinary: boolean;
  backupRoot: string;
};

type ExportedDoc = {
  id: string;
  path: string;
  data: Record<string, unknown>;
  subcollections?: Record<string, ExportedDoc[]>;
};

function parseArgs(argv: string[]): ScriptOptions {
  const execute = argv.includes("--execute");
  const includeStorage = argv.includes("--include-storage");
  const downloadStorage = argv.includes("--download-storage");
  const includeGarage = argv.includes("--include-garage");
  const includeCloudinary = argv.includes("--include-cloudinary");

  const backupDirArg = argv.find((arg) => arg.startsWith("--backup-dir="));
  const backupRoot = backupDirArg
    ? backupDirArg.replace("--backup-dir=", "")
    : path.resolve(process.cwd(), "backups", `firebase-reset-${new Date().toISOString().replace(/[:.]/g, "-")}`);

  return {
    execute,
    includeStorage,
    downloadStorage,
    includeGarage,
    includeCloudinary,
    backupRoot
  };
}

function ensureStorageBucket(): string {
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET?.trim();
  if (!bucketName) {
    throw new Error(
      "FIREBASE_STORAGE_BUCKET is required when using --include-storage or --download-storage."
    );
  }
  return bucketName;
}

function ensureCloudinaryConfig(): {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  deletePrefix: string;
} {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
  const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();
  const deletePrefix = process.env.CLOUDINARY_DELETE_PREFIX?.trim() || "hackethos4u/";

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error(
      "CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET are required when using --include-cloudinary."
    );
  }

  return {
    cloudName,
    apiKey,
    apiSecret,
    deletePrefix
  };
}

function serializeValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value ?? null;
  }

  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }

  if (typeof value !== "object") {
    return value;
  }

  const maybeTimestamp = value as { toDate?: () => Date; toMillis?: () => number };
  if (typeof maybeTimestamp.toDate === "function") {
    return maybeTimestamp.toDate().toISOString();
  }

  const maybeGeoPoint = value as { latitude?: number; longitude?: number };
  if (typeof maybeGeoPoint.latitude === "number" && typeof maybeGeoPoint.longitude === "number") {
    return {
      latitude: maybeGeoPoint.latitude,
      longitude: maybeGeoPoint.longitude
    };
  }

  const maybeDocumentRef = value as { path?: string };
  if (typeof maybeDocumentRef.path === "string") {
    return {
      refPath: maybeDocumentRef.path
    };
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
      key,
      serializeValue(nestedValue)
    ])
  );
}

async function exportDocument(
  doc: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot
): Promise<ExportedDoc> {
  const rawData = doc.data() ?? {};
  const exported: ExportedDoc = {
    id: doc.id,
    path: doc.ref.path,
    data: serializeValue(rawData) as Record<string, unknown>
  };

  const subcollections = await doc.ref.listCollections();
  if (subcollections.length > 0) {
    exported.subcollections = {};
    for (const subcollection of subcollections) {
      const subSnapshot = await subcollection.get();
      exported.subcollections[subcollection.id] = await Promise.all(
        subSnapshot.docs.map((subDoc) => exportDocument(subDoc))
      );
    }
  }

  return exported;
}

async function backupFirestoreCollections(backupRoot: string): Promise<string[]> {
  const collections = await firestore.listCollections();
  const collectionNames = collections.map((collection) => collection.id).sort();
  const firestoreBackupDir = path.join(backupRoot, "firestore");
  await fs.mkdir(firestoreBackupDir, { recursive: true });

  for (const collection of collections) {
    const snapshot = await collection.get();
    const exportedDocs = await Promise.all(snapshot.docs.map((doc) => exportDocument(doc)));
    await fs.writeFile(
      path.join(firestoreBackupDir, `${collection.id}.json`),
      JSON.stringify(exportedDocs, null, 2),
      "utf8"
    );
  }

  return collectionNames;
}

async function backupAuthUsers(backupRoot: string): Promise<auth.UserRecord[]> {
  const users: auth.UserRecord[] = [];
  let nextPageToken: string | undefined;

  do {
    const page = await firebaseAuth.listUsers(1000, nextPageToken);
    users.push(...page.users);
    nextPageToken = page.pageToken;
  } while (nextPageToken);

  const authBackupDir = path.join(backupRoot, "auth");
  await fs.mkdir(authBackupDir, { recursive: true });
  await fs.writeFile(
    path.join(authBackupDir, "users.json"),
    JSON.stringify(
      users.map((user) => ({
        uid: user.uid,
        email: user.email ?? null,
        displayName: user.displayName ?? null,
        phoneNumber: user.phoneNumber ?? null,
        disabled: user.disabled,
        customClaims: user.customClaims ?? {},
        metadata: {
          creationTime: user.metadata.creationTime,
          lastSignInTime: user.metadata.lastSignInTime,
          lastRefreshTime: user.metadata.lastRefreshTime
        },
        providerData: user.providerData
      })),
      null,
      2
    ),
    "utf8"
  );

  return users;
}

async function backupStorage(
  backupRoot: string,
  bucketName: string,
  downloadStorage: boolean
): Promise<void> {
  const bucket = firebaseAdmin.storage().bucket(bucketName);
  const [files] = await bucket.getFiles();
  const storageBackupDir = path.join(backupRoot, "storage");
  await fs.mkdir(storageBackupDir, { recursive: true });

  const manifest = files.map((file) => ({
    name: file.name,
    bucket: file.bucket.name,
    metadata: file.metadata
  }));

  await fs.writeFile(
    path.join(storageBackupDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8"
  );

  if (!downloadStorage) {
    return;
  }

  for (const file of files) {
    const destination = path.join(storageBackupDir, "files", file.name);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await file.download({ destination });
  }
}

type GarageObjectManifest = {
  key: string;
  size: number;
  lastModified: string | null;
  etag: string | undefined;
};

async function listGarageObjects(bucketName: string): Promise<GarageObjectManifest[]> {
  const objects: GarageObjectManifest[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await garageS3.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        ContinuationToken: continuationToken
      })
    );

    for (const item of response.Contents ?? []) {
      if (!item.Key) {
        continue;
      }
      objects.push({
        key: item.Key,
        size: item.Size ?? 0,
        lastModified: item.LastModified?.toISOString() ?? null,
        etag: item.ETag
      });
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return objects;
}

async function backupGarage(backupRoot: string, bucketName: string): Promise<GarageObjectManifest[]> {
  const garageBackupDir = path.join(backupRoot, "garage");
  await fs.mkdir(garageBackupDir, { recursive: true });
  const objects = await listGarageObjects(bucketName);
  await fs.writeFile(
    path.join(garageBackupDir, "manifest.json"),
    JSON.stringify(objects, null, 2),
    "utf8"
  );
  return objects;
}

async function resetGarage(bucketName: string): Promise<void> {
  const objects = await listGarageObjects(bucketName);
  const chunkSize = 1000;

  for (let index = 0; index < objects.length; index += chunkSize) {
    const chunk = objects.slice(index, index + chunkSize);
    console.log(`Deleting Garage objects ${index + 1}-${index + chunk.length} of ${objects.length}`);
    await garageS3.send(
      new DeleteObjectsCommand({
        Bucket: bucketName,
        Delete: {
          Objects: chunk.map((item) => ({ Key: item.key })),
          Quiet: true
        }
      })
    );
  }
}

type CloudinaryResourceManifest = {
  asset_id?: string;
  public_id: string;
  resource_type: string;
  format?: string;
  bytes?: number;
  created_at?: string;
  secure_url?: string;
};

async function listCloudinaryResourcesForType(
  resourceType: "image" | "video" | "raw",
  prefix: string
): Promise<CloudinaryResourceManifest[]> {
  const resources: CloudinaryResourceManifest[] = [];
  let nextCursor: string | undefined;

  do {
    const response = await cloudinary.api.resources({
      type: "upload",
      resource_type: resourceType,
      prefix,
      max_results: 500,
      next_cursor: nextCursor
    });

    for (const resource of response.resources ?? []) {
      resources.push({
        asset_id: resource.asset_id,
        public_id: resource.public_id,
        resource_type: resource.resource_type,
        format: resource.format,
        bytes: resource.bytes,
        created_at: resource.created_at,
        secure_url: resource.secure_url
      });
    }

    nextCursor = response.next_cursor;
  } while (nextCursor);

  return resources;
}

async function backupCloudinary(
  backupRoot: string,
  config: { cloudName: string; apiKey: string; apiSecret: string; deletePrefix: string }
): Promise<Record<string, CloudinaryResourceManifest[]>> {
  cloudinary.config({
    cloud_name: config.cloudName,
    api_key: config.apiKey,
    api_secret: config.apiSecret
  });

  const cloudinaryBackupDir = path.join(backupRoot, "cloudinary");
  await fs.mkdir(cloudinaryBackupDir, { recursive: true });

  const manifest = {
    image: await listCloudinaryResourcesForType("image", config.deletePrefix),
    video: await listCloudinaryResourcesForType("video", config.deletePrefix),
    raw: await listCloudinaryResourcesForType("raw", config.deletePrefix)
  };

  await fs.writeFile(
    path.join(cloudinaryBackupDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8"
  );

  return manifest;
}

async function resetCloudinary(
  config: { cloudName: string; apiKey: string; apiSecret: string; deletePrefix: string }
): Promise<void> {
  cloudinary.config({
    cloud_name: config.cloudName,
    api_key: config.apiKey,
    api_secret: config.apiSecret
  });

  const resources = await backupCloudinary(
    path.resolve(process.cwd(), "backups", "tmp-cloudinary-reset-preview"),
    config
  );

  await fs.rm(path.resolve(process.cwd(), "backups", "tmp-cloudinary-reset-preview"), {
    recursive: true,
    force: true
  });

  for (const resourceType of ["image", "video", "raw"] as const) {
    const publicIds = resources[resourceType].map((resource) => resource.public_id);
    if (publicIds.length === 0) {
      continue;
    }

    const chunkSize = 100;
    for (let index = 0; index < publicIds.length; index += chunkSize) {
      const chunk = publicIds.slice(index, index + chunkSize);
      console.log(
        `Deleting Cloudinary ${resourceType} resources ${index + 1}-${index + chunk.length} of ${publicIds.length}`
      );
      await cloudinary.api.delete_resources(chunk, {
        resource_type: resourceType,
        type: "upload"
      });
    }
  }
}

async function getAdminUserUids(): Promise<Set<string>> {
  const adminUids = new Set<string>();
  const snapshot = await firestore.collection("users").where("role", "==", "admin").get();
  for (const doc of snapshot.docs) {
    adminUids.add(doc.id);
  }
  return adminUids;
}

async function deleteCollection(collectionName: string): Promise<void> {
  await firestore.recursiveDelete(firestore.collection(collectionName));
}

async function resetFirestorePreservingAdmins(adminUids: Set<string>): Promise<void> {
  const collections = await firestore.listCollections();

  for (const collection of collections) {
    if (collection.id === "users") {
      continue;
    }
    console.log(`Deleting collection ${collection.id}`);
    await deleteCollection(collection.id);
  }

  const usersSnapshot = await firestore.collection("users").get();
  for (const userDoc of usersSnapshot.docs) {
    if (adminUids.has(userDoc.id)) {
      continue;
    }
    console.log(`Deleting user document ${userDoc.id}`);
    await userDoc.ref.delete();
  }
}

async function resetAuthPreservingAdmins(
  allUsers: auth.UserRecord[],
  adminUids: Set<string>
): Promise<void> {
  const uidsToDelete = allUsers
    .map((user) => user.uid)
    .filter((uid) => !adminUids.has(uid));

  const chunkSize = 100;
  for (let index = 0; index < uidsToDelete.length; index += chunkSize) {
    const chunk = uidsToDelete.slice(index, index + chunkSize);
    console.log(`Deleting auth users ${index + 1}-${index + chunk.length} of ${uidsToDelete.length}`);
    await firebaseAuth.deleteUsers(chunk);
  }
}

async function resetStorage(bucketName: string): Promise<void> {
  const bucket = firebaseAdmin.storage().bucket(bucketName);
  const [files] = await bucket.getFiles();
  for (const file of files) {
    console.log(`Deleting storage object ${file.name}`);
    await file.delete({ ignoreNotFound: true });
  }
}

async function writeSummary(
  backupRoot: string,
  collections: string[],
  authUsers: auth.UserRecord[],
  adminUids: Set<string>,
  options: ScriptOptions
): Promise<void> {
  const summary = {
    generatedAt: new Date().toISOString(),
    backupRoot,
    execute: options.execute,
    includeStorage: options.includeStorage,
    downloadStorage: options.downloadStorage,
    includeGarage: options.includeGarage,
    includeCloudinary: options.includeCloudinary,
    firestoreCollections: collections,
    totalAuthUsers: authUsers.length,
    preservedAdminUids: Array.from(adminUids).sort()
  };

  await fs.mkdir(backupRoot, { recursive: true });
  await fs.writeFile(path.join(backupRoot, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  console.log("Starting Firebase backup/reset script", {
    execute: options.execute,
    includeStorage: options.includeStorage,
    downloadStorage: options.downloadStorage,
    includeGarage: options.includeGarage,
    includeCloudinary: options.includeCloudinary,
    backupRoot: options.backupRoot
  });

  const adminUids = await getAdminUserUids();
  if (adminUids.size === 0) {
    throw new Error("No admin user documents found in Firestore. Refusing to continue.");
  }

  const collections = await backupFirestoreCollections(options.backupRoot);
  const authUsers = await backupAuthUsers(options.backupRoot);

  if (options.includeStorage || options.downloadStorage) {
    const bucketName = ensureStorageBucket();
    await backupStorage(options.backupRoot, bucketName, options.downloadStorage);
  }

  if (options.includeGarage) {
    await backupGarage(options.backupRoot, process.env.GARAGE_S3_BUCKET ?? "");
  }

  if (options.includeCloudinary) {
    await backupCloudinary(options.backupRoot, ensureCloudinaryConfig());
  }

  await writeSummary(options.backupRoot, collections, authUsers, adminUids, options);

  if (!options.execute) {
    console.log("Backup completed. No data was deleted because --execute was not provided.");
    console.log(`Backups written to ${options.backupRoot}`);
    return;
  }

  console.log(`Preserving admin UIDs: ${Array.from(adminUids).join(", ")}`);
  await resetFirestorePreservingAdmins(adminUids);
  await resetAuthPreservingAdmins(authUsers, adminUids);

  if (options.includeStorage) {
    const bucketName = ensureStorageBucket();
    await resetStorage(bucketName);
  }

  if (options.includeGarage) {
    await resetGarage(process.env.GARAGE_S3_BUCKET ?? "");
  }

  if (options.includeCloudinary) {
    await resetCloudinary(ensureCloudinaryConfig());
  }

  console.log("Firebase reset completed successfully.");
  console.log(`Backups written to ${options.backupRoot}`);
}

void main().catch((error) => {
  console.error("Firebase reset script failed", error);
  process.exit(1);
});
