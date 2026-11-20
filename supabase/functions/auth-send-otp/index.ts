// POST { email } → Authentica emails a one-time sign-in code. Rate limited per email and IP.
import { createDeps } from '../_shared/deps.ts';
import { handleSendOtp } from '../_shared/otp.ts';

const deps = createDeps();

Deno.serve((req) => handleSendOtp(req, deps));
