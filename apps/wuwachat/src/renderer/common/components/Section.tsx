import SectionBg from '@renderer/assets/T_BgPointMask.png'

export function Section({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <section className="relative mb-2 space-y-2">
      <div className="relative mb-2 overflow-hidden rounded pl-3">
        <img src={SectionBg} className="absolute inset-0 object-cover" />
        <h2 className="text-base font-medium text-white/90">{title}</h2>
      </div>
      {children}
    </section>
  )
}
