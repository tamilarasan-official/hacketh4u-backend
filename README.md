# Hacketh4u Backend

Dokploy-ready hybrid backend for Hacketh4u.

## Responsibilities

- verify Firebase user tokens
- create and reconcile Razorpay payments
- expose entitlement checks
- issue Garage S3 signed upload URLs
- perform privileged Firestore writes from the server side

## Quick start

```bash
cp .env.example .env
npm install
npm run dev
```

## Core endpoints

- `GET /health`
- `GET /auth/verify`
- `POST /admin/users/:userId/disable`
- `POST /admin/users/:userId/enable`
- `POST /payments/create-order`
- `POST /payments/verify-client-result`
- `POST /payments/webhooks/razorpay`
- `GET /payments/:paymentId`
- `GET /payments/history`
- `GET /entitlements`
- `GET /entitlements/courses/:courseId`
- `POST /media/upload-url`
- `POST /media/complete`
- `POST /media/delete`

## Required env

See `.env.example`.

## Notes

- Firebase Auth remains the identity provider.
- Firestore remains the main app state store.
- This backend owns payment, entitlement, and Garage S3 orchestration.

## Current hybrid coverage

- `Hybrid now`
- Razorpay order creation, client verification, webhook reconciliation
- Course entitlement checks and entitlement listing
- Admin user enable/disable endpoints
- Garage S3 signed upload and delete flow for user profile images, banners, mentor profile images, course thumbnails, certificate templates, raw course videos, and video thumbnails

- `Still on Firebase for now`
- Realtime chat/community data
- General course/module/video CRUD document storage
- Legacy Cloudinary processing Firebase Functions remain in the repo for historical Firebase-hosted videos

## Recommended next backend cutover

- replace raw video upload/processing with a backend-managed media pipeline
- move more admin-sensitive writes behind backend APIs
- add Garage object deletion endpoints for media lifecycle cleanup
