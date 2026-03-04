import { useParams, useSearchParams } from "react-router-dom";
import { BotDetail } from "@/components/casa-detail";

export function BotDetailPage() {
  const { name } = useParams<{ name: string }>();
  const [searchParams] = useSearchParams();
  const node = searchParams.get("node") ?? undefined;

  if (!name) return null;

  return <BotDetail name={name} node={node} />;
}
