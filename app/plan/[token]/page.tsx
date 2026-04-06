import { redirect } from "next/navigation";

export default async function PlanPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  redirect(`/submit/${token}`);
}
