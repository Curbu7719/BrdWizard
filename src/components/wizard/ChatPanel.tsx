import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import type { ChatMessage, ContextWarningLevel } from '../../hooks/useChat';
import type { Epic, UserStory } from '../../types/brd';
import type { ClassificationData } from './ClassificationForm';

interface ChatPanelProps {
  messages: ChatMessage[];
  streaming: boolean;
  contextLevel: ContextWarningLevel;
  contextPct?: number;
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

  // ── Story approval ────────────────────────────────────────────────────────
  pendingStories?: UserStory[];
  pendingEpicTitle?: string;
  onApproveStory?: (storyId: string) => void;
  onSaveEditedStory?: (storyId: string, text: string) => void;

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
  onApproveStory,
  onSaveEditedStory,
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
        onApproveStory={onApproveStory}
        onSaveEditedStory={onSaveEditedStory}
      />
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
