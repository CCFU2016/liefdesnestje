import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";

export default async function RootPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  if (!session.user.householdId) redirect("/onboarding");
  redirect("/today");
}
