export interface ModelOption {
  id: string;
  label: string;
}

export interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}
