type PendingBannerProps = {
  count: number;
  onViewApprovals: () => void;
};

export function PendingBanner({ count, onViewApprovals }: PendingBannerProps) {
  if (count === 0) return null;

  return (
    <div className="pendingBanner" role="alert">
      <div className="pendingBannerDot" />
      <span className="pendingBannerText">
        {count === 1
          ? "1 tool call is awaiting your approval"
          : `${count} tool calls are awaiting your approval`}
      </span>
      <button className="pendingBannerAction" type="button" onClick={onViewApprovals}>
        Review now →
      </button>
    </div>
  );
}
