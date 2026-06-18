import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import { ChatUsageBar } from './ChatUsageBar';
import type { ChatMessage, ContextWarningLevel, ChatUsage } from '../../hooks/useChat';
import type { Epic, UserStory } from '../../types/brd';
import type { ClassificationData } from './ClassificationForm';

interface ChatPanelProps {
  messages: ChatMessage[];
  streaming: boolean;
  contextLevel: ContextWarningLevel;
  contextPct?: number;
  /** Latest token / context usage for the status bar below the chat. */
  usage?: ChatUsage | null;
  disabled?: boolean;
  onSend: (text: string, file?: File) => void;
  onRetry?: () => void;
  onFinishSection?: () => void;

  // ── Classification ────────────────────────────────────────────────────────
  showClassification?: boolean;
  classificationInitialTitle?: string;
  classificationDisabled?: boolean;
  onClassificationSubmit?: (data: ClassificationData) => void;

  // ── Section approval ──────────────────────────────────────────────────────
  pendingApprovalSectionKey?: string | null;
  onSectionApprove?: (sectionKey: string) => void;

  // ── Epic proposal ─────────────────────────────────────────────────────────
  showEpicProposal?: boolean;
  proposedEpics?: Epic[];
  onApproveAllEpics?: () => void;
  onEditEpicsInChat?: () => void;

  // ── Story approval (batch) ────────────────────────────────────────────────
  pendingStories?: UserStory[];
  pendingEpicTitle?: string;
  onEditStory?: (storyId: string, text: string) => void;
  onRemoveStory?: (storyId: string) => void;
  onAddStory?: () => void;
  onApproveAllStories?: () => void;

  // ── Post-approval continue gate ───────────────────────────────────────────
  /** True when stories are approved and agent may ask clarifications before advancing. */
  awaitingContinue?: boolean;
  /** True when the current epic is the last one (button becomes "Finish BRD"). */
  isLastEpic?: boolean;
  onContinueNextEpic?: () => void;

  // ── Draft section trigger ─────────────────────────────────────────────────
  /** Friendly label for the active section (e.g. "Background"). When provided,
   *  the "Draft <label> for approval" button is shown above the chat input. */
  draftButtonLabel?: string;
  onDraftSection?: () => void;
}

export function ChatPanel({
  messages,
  streaming,
  contextLevel,
  contextPct,
  usage,
  disabled,
  onSend,
  onRetry,
  onFinishSection,
  showClassification,
  classificationInitialTitle,
  classificationDisabled,
  onClassificationSubmit,
  pendingApprovalSectionKey,
  onSectionApprove,
  showEpicProposal,
  proposedEpics,
  onApproveAllEpics,
  onEditEpicsInChat,
  pendingStories,
  pendingEpicTitle,
  onEditStory,
  onRemoveStory,
  onAddStory,
  onApproveAllStories,
  awaitingContinue,
  isLastEpic,
  onContinueNextEpic,
  draftButtonLabel,
  onDraftSection,
}: ChatPanelProps) {
  const inputDisabled = disabled || contextLevel === 'handoff';

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <MessageList
        messages={messages}
        streaming={streaming}
        contextLevel={contextLevel}
        contextPct={contextPct}
        onRetry={onRetry}
        onFinishSection={onFinishSection}
        showClassification={showClassification}
        classificationInitialTitle={classificationInitialTitle}
        classificationDisabled={classificationDisabled}
        onClassificationSubmit={onClassificationSubmit}
        pendingApprovalSectionKey={pendingApprovalSectionKey}
        onSectionApprove={onSectionApprove}
        showEpicProposal={showEpicProposal}
        proposedEpics={proposedEpics}
        onApproveAllEpics={onApproveAllEpics}
        onEditEpicsInChat={onEditEpicsInChat}
        pendingStories={pendingStories}
        pendingEpicTitle={pendingEpicTitle}
        onEditStory={onEditStory}
        onRemoveStory={onRemoveStory}
        onAddStory={onAddStory}
        onApproveAllStories={onApproveAllStories}
        awaitingContinue={awaitingContinue}
        isLastEpic={isLastEpic}
        onContinueNextEpic={onContinueNextEpic}
      />
      {usage && <ChatUsageBar usage={usage} />}
      <ChatInput
        onSend={onSend}
        disabled={inputDisabled}
        streaming={streaming}
        draftButtonLabel={draftButtonLabel}
        onDraftSection={onDraftSection}
      />
    </div>
  );
}
