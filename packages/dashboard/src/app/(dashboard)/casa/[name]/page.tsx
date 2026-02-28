import { CasaDetail } from "@/components/casa-detail";

interface CasaPageProps {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ node?: string }>;
}

export default async function CasaPage({ params, searchParams }: CasaPageProps) {
  const { name } = await params;
  const { node } = await searchParams;
  return <CasaDetail name={name} node={node} />;
}
