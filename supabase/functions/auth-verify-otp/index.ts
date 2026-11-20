// POST { email, code } → Authentica checks the code; if it's right, returns a Supabase session.
import { createDeps } from '../_shared/deps.ts';
import { handleVerifyOtp } from '../_shared/otp.ts';

const deps = createDeps();

Deno.serve((req) => handleVerifyOtp(req, deps));
