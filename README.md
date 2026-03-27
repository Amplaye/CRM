# TableFlow AI - Restaurant Operations Hub

TableFlow AI is a production-oriented, multi-tenant SaaS CRM and operational dashboard for restaurants using WhatsApp and voice AI agents.

## Features Built
- **Next.js App Router (v15)** + React 19 + TypeScript.
- **Tailwind CSS v4** with a highly polished custom theme (Terracotta, Olive, and Zinc).
- **Multi-Tenant Architecture**: Strict Firebase Security Rules enforced at the tenant level.
- **Role-Based Access Control (RBAC)**: Admins, Owners, Managers, and Hosts.
- **Robust UI/UX**: Lighter borders, beautiful data visualizations for ROI, interactive slide-over drawers, loading states, and error boundaries.
- **Waitlist Auto-Matching**: Premium UI for displaying AI-driven guest matching.
- **Core Operations**: Reservations, Unified Inbox, Guest directories, and Settings.
- **AI Webhook Support**: Ready to ingest from external AI platforms (Bland AI, Vapi, Retell).

## 1. Prerequisites
- Node.js (v18+)
- Firebase CLI (`npm install -g firebase-tools`)
- Java (Required for Firebase Emulators)

## 2. Running Locally (Emulators)

This app is configured to run fully offline using the Firebase Emulator Suite for a safe, multi-tenant sandbox.

**Step 1. Install Dependencies**
```bash
npm install
```

**Step 2. Start Firebase Emulators in the background**
```bash
firebase emulators:start
```
*Note: The emulators run Auth on 9099 and Firestore on 8080.*

**Step 3. Seed Database**
In a new terminal window, compile and run the seed script to create demo tenants (PICNIC), users, and data.
```bash
npx ts-node scripts/seed.ts
```
*(If `ts-node` is missing: `npm i -D ts-node`)*

**Step 4. Start Next.js Development Server**
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000)

## 3. Deployment (Firebase App Hosting)

Next.js apps are perfectly suited for the new Firebase App Hosting or Vercel.

1. Init your real Firebase project:
   ```bash
   firebase login
   firebase use --add
   ```
2. Deploy Firestore Rules:
   ```bash
   firebase deploy --only firestore:rules
   ```
3. Deploy Application (Vercel or Firebase App Hosting):
   - For App Hosting, just connect your GitHub repository to Firebase App Hosting in the Firebase Console.
   - Set environment variables (`NEXT_PUBLIC_FIREBASE_API_KEY`, etc.) in the console. Do not use the mock `client.ts` placeholders.

## 4. Known Next Steps for Production Hardening
- **Auth UI:** Implement the actual `/login` and `/signup` screens.
- **Environment Variables:** Replace hardcoded `firebaseConfig` in `client.ts` with `process.env.NEXT_PUBLIC_...` variables.
- **Webhook Security:** Add HMAC signature verification to `app/api/webhooks/incoming-message/route.ts` to block unauthorized requests.
- **Pagination:** Implement standard Firestore pagination limits in the `ReservationList.tsx` and `Conversations` views to handle thousands of records.
- **Global Search Indexing:** Connect Algolia or Typesense to sync Firestore data for real-time, cross-field searching.
