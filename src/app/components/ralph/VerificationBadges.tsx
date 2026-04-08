import { CheckCircle, XCircle } from "lucide-react";
import { cn, Chip } from "../../UI";

interface Verification {
  tier: string;
  testsPassed: boolean;
  lintsPassed: boolean;
  deslopPassed: boolean;
  regressionsPassed: boolean;
}

interface VerificationBadgesProps {
  verifications: Verification[];
}

function StatusIcon({ passed }: { passed: boolean }) {
  return passed ? (
    <CheckCircle className="w-4 h-4 text-emerald-400" />
  ) : (
    <XCircle className="w-4 h-4 text-rose-400" />
  );
}

function Badge({
  label,
  passed,
}: {
  label: string;
  passed: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs font-medium",
        passed
          ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
          : "bg-rose-500/10 border-rose-500/20 text-rose-400",
      )}
    >
      <StatusIcon passed={passed} />
      {label}
    </div>
  );
}

export function VerificationBadges({ verifications }: VerificationBadgesProps) {
  if (verifications.length === 0) {
    return (
      <div className="px-5 py-3 text-xs text-zinc-500">
        No verifications yet
      </div>
    );
  }

  const latest = verifications[verifications.length - 1];

  return (
    <div className="px-5 py-3 space-y-2">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-zinc-400 font-medium">Verification</span>
        <Chip variant={latest.tier === "THOROUGH" ? "ok" : "subtle"}>
          {latest.tier}
        </Chip>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge label="Tests" passed={latest.testsPassed} />
        <Badge label="Lints" passed={latest.lintsPassed} />
        <Badge label="Deslop" passed={latest.deslopPassed} />
        <Badge label="Regression" passed={latest.regressionsPassed} />
      </div>
    </div>
  );
}
