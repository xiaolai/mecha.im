import { CasaDetail } from "@/components/casa-detail";

interface CasaPageProps {
  params: Promise<{ name: string }>;
}

export default async function CasaPage({ params }: CasaPageProps) {
  const { name } = await params;
  return <CasaDetail name={name} />;
}
