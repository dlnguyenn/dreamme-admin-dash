import { Suspense } from "react";
import { Sparkles } from "lucide-react";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in · DreamMe Admin" };

export default function LoginPage() {
  return (
    <div className="min-h-screen grid place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 justify-center mb-6">
          <div className="size-9 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 grid place-items-center text-white">
            <Sparkles className="size-5" />
          </div>
          <div className="font-semibold text-lg tracking-tight">DreamMe Admin</div>
        </div>
        <div className="card p-6">
          <h1 className="text-lg font-semibold">Sign in</h1>
          <p className="text-sm text-slate-500 mt-1">
            We&apos;ll email you a magic link. Only allow-listed addresses can access
            the dashboard.
          </p>
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
