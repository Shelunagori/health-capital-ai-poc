/**
 * Shown on every page. Anyone looking at this should know immediately that none of it is real, and
 * that it makes no compliance claim.
 */
export function SyntheticBanner(): JSX.Element {
  return (
    <div className="banner" role="note">
      Synthetic-data demonstration environment. No real healthcare, identity, employer, or financial
      data is used.
    </div>
  );
}
