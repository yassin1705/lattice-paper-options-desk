'use client';

import { useEffect, useState } from 'react';

import { mockSnapshot } from '@/lib/dashboard/mock-data';
import type { DashboardSnapshot } from '@/lib/dashboard/types';

export function useDashboardSnapshot() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>(mockSnapshot);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    fetch('/api/dashboard', { cache: 'no-store', signal: controller.signal })
      .then((response) => response.json() as Promise<DashboardSnapshot>)
      .then(setSnapshot)
      .catch(() => undefined)
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, []);

  return { snapshot, loading };
}
