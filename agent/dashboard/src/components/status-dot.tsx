const colors = {
  green: "bg-green-500",
  yellow: "bg-yellow-500",
  red: "bg-red-500",
  blue: "bg-blue-500",
  muted: "bg-muted-foreground",
  "muted-light": "bg-muted-foreground/30",
  "muted-lighter": "bg-muted-foreground/40",
  success: "bg-success",
} as const;

const sizeClass = {
  sm: "w-1.5 h-1.5",
  md: "w-2 h-2",
  lg: "w-2.5 h-2.5",
} as const;

type Props = {
  color?: keyof typeof colors;
  size?: keyof typeof sizeClass;
  pulse?: boolean;
  className?: string;
};

export default function StatusDot({ color = "muted", size = "md", pulse, className = "" }: Props) {
  return (
    <span
      className={`${sizeClass[size]} rounded-full ${colors[color]} ${pulse ? "animate-pulse" : ""} shrink-0 ${className}`}
    />
  );
}
