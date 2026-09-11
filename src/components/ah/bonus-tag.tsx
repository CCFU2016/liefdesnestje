export function BonusTag({ label, title }: { label: string; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none text-orange-800 dark:bg-orange-950 dark:text-orange-300"
    >
      Bonus{label && label.toLowerCase() !== "bonus" ? ` · ${label}` : ""}
    </span>
  );
}
