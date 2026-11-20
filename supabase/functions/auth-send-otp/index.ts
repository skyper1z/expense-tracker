// POST { email } → emails a one-time 6-digit sign-in code (via Brevo or Resend). Rate limited per email and IP.
import { createDeps } from '../_shared/deps.ts';
import { handleSendOtp } from '../_shared/otp.ts';

const deps = createDeps();

Deno.serve((req) => handleSendOtp(req, deps));
