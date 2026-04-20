import DTLogo from "../../../packages/brand-ui/src/DTLogo";

export function BrandWordmark() {
  return (
    <>
      <span className="sm:hidden">
        <DTLogo variant="full" width={80} onDark />
      </span>
      <span className="hidden sm:inline-flex">
        <DTLogo variant="full" width={96} onDark />
      </span>
    </>
  );
}
