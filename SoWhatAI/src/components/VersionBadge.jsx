import React from 'react';

const commitRef = import.meta.env.VITE_COMMIT_REF;
const shortHash = commitRef ? String(commitRef).slice(0, 7) : 'dev';

export default function VersionBadge() {
  return (
    <p className="text-xs text-gray-600 select-none">
      build {shortHash}
    </p>
  );
}
