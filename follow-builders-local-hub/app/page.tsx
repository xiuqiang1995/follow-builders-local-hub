import { DashboardShell } from '@/components/dashboard-shell';
import { getDashboardData } from '@/lib/db';
import type { DashboardData } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const dashboard = JSON.parse(JSON.stringify(await getDashboardData())) as DashboardData;

  return <DashboardShell dashboard={dashboard} />;
}
