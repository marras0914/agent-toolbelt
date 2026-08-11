/**
 * Process entry point. Nothing lives here but the decision to actually run.
 *
 * The Express app and every route are built in ./app, which does NOT listen on
 * import. That separation is what lets tests exercise the real handlers — the guest
 * /api/try path and the admin delete guards previously had to be re-implemented in
 * test files because importing the app started a server.
 *
 * Referenced by `npm start` (node dist/index.js), the Dockerfile CMD, and
 * `npm run dev` (tsx watch src/index.ts). Keep it thin.
 */
import { startServer } from "./app";

startServer();
