"use strict";

/** Classify only completed scan evidence; exit 2 is deliberately ambiguous. */
function classifyScanResult({ code, output = "", aborted = false } = {}) {
  const details = typeof output === "string" ? output.slice(-12_000) : "";
  if (aborted)
    return {
      status: "cancelled",
      message: "Wet scan stopped. Protection was not verified.",
      details,
    };
  if (!Number.isInteger(code))
    return {
      status: "unavailable",
      message:
        "Microsoft Defender could not complete this scan. Open Windows Security to check your antivirus provider.",
      details,
    };
  if (code === 0)
    return {
      status: "clear",
      message:
        "Defender completed this scan without a reported threat. Other folders were not scanned.",
    };
  return {
    status: "attention",
    message: `Defender needs attention (exit ${code}). This may mean a detection or a scan error. Open Windows Security.`,
    details,
  };
}

module.exports = { classifyScanResult };
