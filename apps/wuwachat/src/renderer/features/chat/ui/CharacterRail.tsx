import { useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { gsap } from 'gsap'
import { Flip } from 'gsap/Flip'
import { useSkinSlot, useSkinStyle } from '@renderer/features/appearance'
import { cn } from '@renderer/common/lib/cn'
import { Plus } from 'lucide-react'
import CharacterCard from './CharacterCard'
import GroupCard from './GroupCard'
import { CreateGroupDialog } from './CreateGroupDialog'
import { useMotionPreference } from '@renderer/app/hooks/useMotionPreference'
import { useCharacterRegistryStore } from '@renderer/store/character-registry'
import { useSessionStore } from '@renderer/store/session'

gsap.registerPlugin(Flip)

export default function CharacterRail(): ReactElement {
  const localCharacters = useCharacterRegistryStore((state) => state.registry.local)
  const groups = useSessionStore((state) => state.groups)
  const summaries = useSessionStore((state) => state.summaries)
  const characters = useMemo(
    () => localCharacters.filter((character) => character.visible !== false),
    [localCharacters]
  )
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false)

  // 群聊成员摘要单独缓存：会话快照变化只影响排序，不产生新的成员数组引用。
  const groupParticipants = useMemo(
    () =>
      new Map(
        groups.map((group) => [
          group.id,
          group.participantIds
            .map((id) => characters.find((character) => character.id === id))
            .filter((character): character is (typeof characters)[number] => Boolean(character))
        ])
      ),
    [characters, groups]
  )
  const railItems = useMemo(() => {
    const characterEntries = characters.map((character, index) => ({
      kind: 'character' as const,
      character,
      pinned: character.settings.pinned === true,
      index,
      latestAt:
        summaries
          .filter((summary) => summary.ownerId === character.id)
          .map((summary) => summary.updatedAt)
          .sort()
          .at(-1) || ''
    }))
    const groupEntries = groups.map((group, index) => ({
      kind: 'group' as const,
      group,
      pinned: group.pinned === true,
      participants: groupParticipants.get(group.id) || [],
      index: characters.length + index,
      latestAt:
        summaries
          .filter((summary) => summary.ownerId === group.id)
          .map((summary) => summary.updatedAt)
          .sort()
          .at(-1) || group.createdAt
    }))
    return [...characterEntries, ...groupEntries].sort((left, right) => {
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1
      if (!left.latestAt && !right.latestAt) return left.index - right.index
      if (!left.latestAt) return 1
      if (!right.latestAt) return -1
      return right.latestAt.localeCompare(left.latestAt)
    })
  }, [characters, groups, groupParticipants, summaries])

  const railListRef = useRef<HTMLDivElement>(null)
  const flipStateRef = useRef<ReturnType<typeof Flip.getState> | null>(null)
  const { shouldAnimate } = useMotionPreference()
  const railBackground = useSkinSlot('railBackground')
  const railBackgroundStyle = useSkinStyle('railBackground')

  // 每次提交后先按上一帧快照归位再重新捕获，卡片增删或重排时其余卡片平滑滑到新位置。
  useLayoutEffect(() => {
    const container = railListRef.current
    if (!container) {
      return
    }

    const cards = container.querySelectorAll<HTMLElement>('[data-rail-card]')
    if (cards.length === 0) {
      flipStateRef.current = null
      return
    }

    const previousState = flipStateRef.current
    if (previousState && shouldAnimate) {
      Flip.from(previousState, { duration: 0.28, ease: 'power2.out' })
    }
    flipStateRef.current = Flip.getState(cards)
  })

  return (
    <div className="relative h-156 w-78 shrink-0">
      <img
        src={railBackground}
        className={cn(
          'absolute top-0 h-full w-full object-cover object-left drop-shadow-[0_0_0_#ffffff]',
          railBackgroundStyle
        )}
        draggable="false"
      />

      <div
        ref={railListRef}
        className="absolute flex h-full w-full flex-col gap-1 overflow-y-auto pt-4 pr-2 pb-16 pl-6"
      >
        {railItems.map((item) =>
          item.kind === 'character' ? (
            <CharacterCard key={item.character.id} char={item.character} isPinned={item.pinned} />
          ) : (
            <GroupCard
              key={item.group.id}
              group={item.group}
              participants={item.participants}
              isPinned={item.pinned}
            />
          )
        )}
      </div>

      <button
        type="button"
        aria-label="新建群聊"
        className="absolute bottom-4 left-6 z-10 flex size-10 items-center justify-center rounded-full border border-white/40 text-white transition-colors hover:bg-white/15"
        onClick={() => setIsCreateGroupOpen(true)}
      >
        <Plus className="size-5" />
      </button>

      {isCreateGroupOpen && (
        <CreateGroupDialog characters={characters} onClose={() => setIsCreateGroupOpen(false)} />
      )}
    </div>
  )
}
