import DTLogo from "../../../packages/brand-ui/src/DTLogo";

type BrandWordmarkProps = {
  className?: string;
};

export function BrandWordmark({ className = "" }: BrandWordmarkProps) {
  return (
    <DTLogo variant="full" width={200} onDark className={className} />
  );
}
