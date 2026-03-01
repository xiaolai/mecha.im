import { useParams, useSearchParams } from "react-router-dom";
import { CasaDetail } from "@/components/casa-detail";

export function CasaDetailPage() {
  const { name } = useParams<{ name: string }>();
  const [searchParams] = useSearchParams();
  const node = searchParams.get("node") ?? undefined;

  if (!name) return null;

  return <CasaDetail name={name} node={node} />;
}
