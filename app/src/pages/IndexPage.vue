<template>
  <div
    class="app-shell"
    :data-theme="settingsDraft.theme"
    :class="{
      'left-collapsed': !leftOpen,
      'right-collapsed': !rightOpen || settingsOpen || (!selectedNative && !selectedRoom && !selectedProject),
    }"
  >
    <header class="topbar">
      <button
        class="brand-lockup"
        aria-label="Toggle chats and projects"
        :aria-expanded="leftOpen"
        @click="leftOpen = !leftOpen"
      >
        <span class="brand-mark">:o</span>
        <span class="brand-art" aria-hidden="true"></span>
        <span class="brand-name"
          >/ {{ selectedProject ? projectName(selectedProject) : 'surprised-face' }}</span
        >
      </button>
      <div class="topbar-actions">
        <span
          class="connection-state"
          :class="{ online: settings.connected && connectedRoomIds.has(currentRoomId) }"
        >
          <span class="status-dot"></span>{{ settings.connected ? 'Connected' : 'Local' }}
        </span>
        <button
          v-if="!settingsOpen && (selectedRoom || selectedNative || selectedProject)"
          class="icon-button"
          :title="rightOpen ? 'Hide people and agents' : 'Show people and agents'"
          :aria-label="rightOpen ? 'Hide people and agents' : 'Show people and agents'"
          :aria-expanded="rightOpen"
          @click="rightOpen = !rightOpen"
        >
          <PanelRightClose v-if="rightOpen" :size="18" /><PanelRightOpen v-else :size="18" />
        </button>
      </div>
    </header>

    <div class="workspace">
      <aside v-if="leftOpen" class="left-sidebar">
        <div class="sidebar-search">
          <Search :size="15" />
          <input
            v-model="catalogQuery"
            type="search"
            aria-label="Search projects and chats"
            placeholder="Search projects and chats"
          />
        </div>
        <div class="sidebar-filters">
          <select v-model="harnessFilter" aria-label="Filter by harness">
            <option value="">All harnesses</option>
            <option v-for="harness in harnessOptions" :key="harness" :value="harness">
              {{ harnessLabel(harness) }}
            </option>
          </select>
          <select v-model="agentFilter" aria-label="Filter by agent">
            <option value="">All agents</option>
            <option v-for="agent in agentOptions" :key="agent.value" :value="agent.value">
              {{ agent.label }}
            </option>
          </select>
        </div>
        <div class="sidebar-scroll">
          <div class="sidebar-section-head">
            <button
              class="sidebar-section-toggle"
              :aria-expanded="projectsExpanded"
              @click="projectsExpanded = !projectsExpanded"
            >
              <ChevronDown v-if="projectsExpanded" :size="14" /><ChevronRight
                v-else
                :size="14"
              />Projects <span>{{ filteredProjects.length }}</span>
            </button>
            <div class="sidebar-tools"><button
              class="small-icon-button"
              aria-label="Refresh local list"
              title="Refresh"
              @click="refreshCatalog"
            >
              <RefreshCw :size="14" />
            </button>
            <button class="small-icon-button" aria-label="New chat" title="New chat" @click="newRoom()"><Plus :size="15" /></button></div>
          </div>
          <template v-if="projectsExpanded">
            <template v-for="project in visibleProjects" :key="projectKey(project)">
              <div class="project-row">
              <button
                class="sidebar-row project-button"
                :class="{ selected: selectedProject && projectKey(project) === projectKey(selectedProject) }"
                :title="String(project.path || '')"
                :aria-expanded="Boolean(selectedProject && projectKey(project) === projectKey(selectedProject))"
                @click="selectProject(project)"
              >
                <ChevronDown v-if="selectedProject && projectKey(project) === projectKey(selectedProject)" :size="14" />
                <ChevronRight v-else :size="14" /><FolderOpen :size="15" /><span>{{ projectName(project) }}</span>
              </button>
              <button class="small-icon-button project-new-chat" :aria-label="`New chat in ${projectName(project)}`" :title="`New chat in ${projectName(project)}`" @click="newRoom(project)"><Plus :size="15" /></button>
              </div>
              <template v-if="selectedProject && projectKey(project) === projectKey(selectedProject)">
                <button
                  v-for="conversation in projectConversations(project).slice(0, visibleConversationCount)"
                  :key="conversationKey(conversation)"
                  class="sidebar-row local-chat-row"
                  :class="{ selected: selectedNative && conversationKey(conversation) === conversationKey(selectedNative) }"
                  @click="openNativeConversation(conversation)"
                >
                  <span class="harness-mark" :class="`harness-${conversation.harness}`">{{ harnessInitial(conversation.harness) }}</span>
                  <span>{{ conversation.title || conversation.id }}</span>
                </button>
                <p v-if="!projectConversations(project).length" class="sidebar-note">No chats in this project.</p>
                <button v-if="projectConversations(project).length > visibleConversationCount" class="sidebar-row more-row" @click="visibleConversationCount += 80">Show more chats</button>
              </template>
            </template>
            <button
              v-if="visibleProjects.length < filteredProjects.length"
              class="sidebar-row more-row"
              @click="visibleProjectCount += 80"
            >
              Show more projects
            </button>
            <p v-if="catalogLoading && !projects.length" class="sidebar-note">
              Reading local projects…
            </p>
            <p v-else-if="!projects.length" class="sidebar-note">No local projects found.</p>
          </template>

          <div v-if="rooms.length" class="sidebar-section-head sidebar-section-head--spaced">
            <span>Chats</span>
          </div>
          <button
            v-for="room in filteredRooms"
            :key="room.id"
            class="sidebar-row"
            :class="{ selected: currentRoomId === room.id && !selectedNative && !settingsOpen }"
            @click="selectRoom(room)"
          >
            <MessageSquare :size="15" /><span>{{ room.name }}</span>
          </button>
          <p v-if="rooms.length && !filteredRooms.length" class="sidebar-note">
            No matching chats.
          </p>

          <div v-if="unfiledConversations.length" class="sidebar-section-head sidebar-section-head--spaced">Other local chats</div>
          <template v-if="unfiledConversations.length">
            <button
              v-for="conversation in unfiledConversations.slice(0, visibleConversationCount)"
              :key="conversationKey(conversation)"
              class="sidebar-row local-chat-row"
              :class="{
                selected:
                  selectedNative &&
                  conversationKey(conversation) === conversationKey(selectedNative),
              }"
              @click="openNativeConversation(conversation)"
            >
              <span class="harness-mark" :class="`harness-${conversation.harness}`">{{
                harnessInitial(conversation.harness)
              }}</span>
              <span>{{ conversation.title || conversation.id }}</span>
            </button>
            <button
              v-if="unfiledConversations.length > visibleConversationCount"
              class="sidebar-row more-row"
              @click="visibleConversationCount += 80"
            >
              Show more chats
            </button>
          </template>
          <p v-if="catalogError" class="sidebar-note error-text">{{ catalogError }}</p>
        </div>
        <div class="sidebar-bottom">
          <button
            class="sidebar-row settings-nav"
            :class="{ selected: settingsOpen }"
            @click="settingsOpen = !settingsOpen"
          >
            <Settings2 :size="16" /><span>Settings</span>
          </button>
        </div>
      </aside>

      <main class="main-panel" :class="{ 'main-panel-settings': settingsOpen }">
        <div v-if="settingsSaveError && !settingsOpen" class="settings-save-warning" role="alert">
          <span>{{ settingsSaveError }}</span><button class="text-button" :disabled="settingsSaving" @click="saveGeneralSettings">Retry saving</button>
        </div>
        <template v-if="settingsOpen">
          <div class="settings-page">
            <div class="settings-header">
              <div><h1>Settings</h1></div>
              <button class="outline-button" @click="settingsOpen = false"><ArrowLeft :size="15" /> Back to chat</button>
            </div>
            <div class="settings-scroll">
              <div class="settings-grid">
                <section class="settings-section">
                  <h3>Chat sharing</h3>
                  <p class="section-help">:o handles the chat service. Open a chat and choose Invite friend to share it.</p>
                  <label
                    >Your name<input v-model="settingsDraft.displayName" placeholder="Name"
                  /></label>
                    <div class="connection-forms">
                      <div class="connection-card">
                        <strong>Join a chat</strong
                        ><label
                          >Invite code<input
                            v-model="inviteCode"
                            autocomplete="off"
                            placeholder="Invite code" /></label
                        ><button
                          class="outline-button full-button"
                          :disabled="connecting || !canJoin"
                          @click="joinWorkspace"
                        >
                          <LoaderCircle v-if="connecting" :size="15" class="spin" />Join chat
                        </button>
                      </div>
                    </div>
                  <div v-if="settings.connected" class="connected-account">
                    <span class="status-dot online"></span
                    ><span
                      >{{ settings.member?.name }}<small>Ready to share chats</small></span
                    ><button class="text-button" @click="logout">Disconnect</button>
                  </div>
                  <p v-if="connectionError" class="error-text">{{ connectionError }}</p>
                </section>
                <section class="settings-section">
                  <h3>Appearance</h3>
                  <div class="theme-options">
                    <button
                      v-for="theme in themeOptions"
                      :key="theme.value"
                      :class="[
                        'theme-option',
                        `theme-option-${theme.value}`,
                        { active: settingsDraft.theme === theme.value },
                      ]"
                      @click="settingsDraft.theme = theme.value"
                    >
                      <span class="theme-swatch"><span>:o</span></span
                      ><span>{{ theme.label }}</span>
                    </button>
                  </div>
                </section>
                <section class="settings-section">
                  <div class="section-title-row">
                    <h3>Local agents</h3>
                    <button class="small-icon-button" title="Add agent" @click="addAgent">
                      <Plus :size="15" />
                    </button>
                  </div>
                  <p class="section-help">
                    Each agent uses the harness and working folder on this computer.
                  </p>
                  <div class="agent-picker" v-if="agentDrafts.length > 1">
                    <button
                      v-for="(agent, index) in agentDrafts"
                      :key="agent.id || index"
                      :class="{ active: selectedAgentDraft === index }"
                      @click="selectedAgentDraft = index"
                    >
                      {{ agent.name || `Agent ${index + 1}` }}
                    </button>
                  </div>
                  <template v-if="activeAgentDraft">
                    <label
                      >Agent name<input
                        v-model="activeAgentDraft.name"
                        placeholder="e.g. maya-agent"
                    /></label>
                    <label
                      >Agent ID<input v-model="activeAgentDraft.id" placeholder="e.g. maya-agent"
                    /></label>
                    <label
                      >Harness<select v-model="activeAgentDraft.harness">
                        <option value="codex">Codex</option>
                        <option value="hermes">Hermes</option>
                      </select></label
                    >
                    <label
                      >Model<input
                        v-model="activeAgentDraft.model"
                        placeholder="Use harness default"
                    /></label>
                    <div class="folder-field">
                      <label
                        >Working folder<input
                          :value="activeAgentDraft.workingDirectory"
                          readonly
                          placeholder="Choose a project folder" /></label
                      ><button class="outline-button" @click="chooseWorkingFolder">
                        <FolderOpen :size="15" />Choose
                      </button>
                    </div>
                    <button
                      class="primary-button full-button"
                      :disabled="savingAgent || !canSaveAgent"
                      @click="saveAgent"
                    >
                      <LoaderCircle v-if="savingAgent" :size="15" class="spin" />Save agent
                    </button>
                  </template>
                  <label class="toggle-row"
                    ><span
                      ><strong>Run agent mentions on this computer</strong
                      ><small
                        >Allows messages from this workspace to start your local harness.</small
                      ></span
                    ><input v-model="allowAgentRuns" type="checkbox"
                  /></label>
                  <p class="section-help">
                    When off, mentions remain queued until you turn this on.
                  </p>
                </section>
                <section class="settings-section">
                  <h3>Harness status</h3>
                  <div class="harness-status-row codex-account-row">
                    <span class="harness-mark harness-codex">C</span
                    ><span
                      >Codex<small>{{ codexStatus }}</small></span>
                    <div class="harness-account-actions">
                      <button class="text-button" :disabled="!!codexBusy" @click="checkCodex()"><LoaderCircle v-if="codexBusy === 'checking'" :size="14" class="spin" />Check status</button>
                      <button v-if="codexAccountState === 'signed-in'" class="text-button" :disabled="!!codexBusy" @click="signOutCodex"><LoaderCircle v-if="codexBusy === 'signing-out'" :size="14" class="spin" />Sign out</button>
                      <button v-if="codexAccountState === 'signed-out'" class="text-button" :disabled="!!codexBusy || codexLoginPending" @click="signInCodex"><LoaderCircle v-if="codexBusy === 'signing-in' || codexLoginPending" :size="14" class="spin" />Sign in</button>
                    </div>
                  </div>
                  <p v-if="codexFeedback" class="harness-account-feedback" role="status" aria-live="polite">{{ codexFeedback }}</p>
                  <p v-if="codexError" class="error-text" role="alert">{{ codexError }}</p>
                  <div class="harness-status-row">
                    <span class="harness-mark harness-hermes">H</span
                    ><span
                      >Hermes<small>{{ hermesStatusText }}</small></span
                    ><button class="text-button" @click="checkHermes">Refresh</button>
                  </div>
                  <p v-if="harnessError" class="error-text">{{ harnessError }}</p>
                </section>
                <section class="settings-section">
                  <h3>Local chats and projects</h3>
                  <p class="section-help">
                    The list updates automatically from the harnesses on this computer.
                  </p>
                  <button class="outline-button" :disabled="catalogLoading" @click="refreshCatalog">
                    <RefreshCw :size="15" :class="{ spin: catalogLoading }" />Refresh now
                  </button>
                  <p v-if="catalogError" class="error-text">{{ catalogError }}</p>
                </section>
              </div>
            </div>
            <div class="settings-footer">
              <span v-if="settingsSaveError" class="error-text" role="alert">{{ settingsSaveError }}</span>
              <span v-else role="status" aria-live="polite"><LoaderCircle v-if="settingsSaving" :size="15" class="spin" />{{ settingsSaving ? 'Saving settings...' : settingsSaved ? 'Settings saved automatically' : 'Changes save automatically' }}</span>
              <button v-if="settingsSaveError" class="outline-button" :disabled="settingsSaving" @click="saveGeneralSettings">Retry saving</button>
            </div>
          </div>
        </template>
        <template v-else-if="selectedNative || !selectedRoom">
          <div class="view-header">
            <div>
              <h1>{{ selectedNative?.title || 'New chat' }}</h1>
              <p v-if="selectedProject" class="subheading">{{ projectName(selectedProject) }}</p>
            </div>
            <div class="room-actions">
              <button class="primary-button chat-action" aria-label="Invite friend" :title="selectedNative ? 'Invite friend' : 'Send a message before inviting a friend'" :disabled="!selectedNative || nativeLoading || nativeSending || inviting || !nativeChatSupported || !selectedNative.path" @click="shareNativeConversation"><LoaderCircle v-if="inviting" :size="17" class="spin" /><UserPlus v-else :size="17" />Invite friend</button>
              <button class="outline-button chat-action" aria-label="Join a chat" @click="joinChat"><LogIn :size="17" />Join a chat</button>
            </div>
          </div>
          <div ref="nativeViewport" class="native-content">
            <div v-if="nativeTranscript || nativeAddedMessages.length" class="transcript-list">
              <article
                v-for="(message, index) in nativeDisplayMessages"
                :key="`${index}-${message.at || ''}`"
                class="transcript-message"
                :class="message.role"
              >
                <div class="message-meta">
                  <span
                    class="role-tag"
                    :class="message.role === 'assistant' ? 'agent-tag' : 'human-tag'"
                    >{{ message.role }}</span
                  ><time v-if="message.at">{{ formatTime(message.at) }}</time>
                </div>
                <pre>{{ message.content }}</pre>
              </article>
            </div>
            <div v-else class="empty-state">
              <MessageSquare :size="24" />
              <p>{{ nativeLoading ? 'Loading chat...' : 'Send your first message' }}</p>
            </div>
          </div>
          <p v-if="nativeError" class="native-status error-text">{{ nativeError }}</p>
          <form class="composer" @submit.prevent="sendNativeDraft">
            <textarea v-model="nativeDraft" aria-label="Message" rows="2" :placeholder="nativeChatSupported ? 'Message...' : 'This harness cannot send from :o yet'" :disabled="!nativeChatSupported" @keydown.enter.exact.prevent="sendNativeDraft"></textarea>
            <div class="composer-footer">
              <div class="composer-controls">
                <select :value="composerProjectPath" aria-label="Project" :disabled="nativeSending" @change="changeComposerProject(($event.target as HTMLSelectElement).value)"><option value="" disabled>Choose project</option><option v-for="project in composerProjects" :key="String(project.path)" :value="String(project.path)">{{ projectName(project) }}</option></select>
                <select v-if="!selectedNative" v-model="newChatHarness" aria-label="Agent" :disabled="nativeSending"><option value="codex">Codex</option><option value="hermes">Hermes</option></select>
                <span v-else>{{ nativeSending ? 'Replying...' : harnessLabel(selectedNative.harness) }}</span>
              </div>
              <button class="send-button" type="submit" :disabled="!nativeDraft.trim() || !nativeCanSend" aria-label="Send message"><LoaderCircle v-if="nativeSending" :size="16" class="spin" /><Send v-else :size="16" /></button>
            </div>
          </form>
        </template>

        <template v-else>
          <div class="room-heading">
            <div>
              <p class="eyebrow">CHAT</p>
              <h1>{{ selectedRoom?.name || 'Choose a chat' }}</h1>
              <p v-if="selectedProject" class="subheading">{{ selectedProject.path }}</p>
            </div>
            <div v-if="selectedRoom" class="room-actions">
              <span v-if="activeAgentName" class="active-agent"
                ><span class="status-dot busy"></span>{{ activeAgentName }} is replying</span
              >
              <span v-else-if="queuedAgentNames.length" class="active-agent"
                ><span class="status-dot queued"></span
                >{{ queuedAgentNames.join(', ') }} queued</span
              >
              <button class="primary-button chat-action" aria-label="Invite friend" :disabled="inviting" @click="createRoomInvite"><LoaderCircle v-if="inviting" :size="17" class="spin" /><UserPlus v-else :size="17" />Invite friend</button>
              <button class="outline-button chat-action" aria-label="Join a chat" @click="joinChat"><LogIn :size="17" />Join a chat</button>
            </div>
          </div>

          <div ref="messageViewport" class="message-viewport">
            <div v-if="!selectedRoom" class="empty-state">
              <MessageSquare :size="24" />
              <h2>New chat</h2>
              <button class="primary-button" @click="newRoom()"><Plus :size="16" /> New chat</button>
            </div>
            <div v-else-if="!messages.length" class="empty-state room-empty">
              <p class="eyebrow">{{ selectedRoom.name }}</p>
              <h2>Messages appear here.</h2>
              <p>{{ members.length === 1 ? 'Write a message and your agent will answer.' : 'Write to the people in this chat. Mention an agent when you want it to act.' }}</p>
            </div>
            <div v-else class="message-list">
              <article
                v-for="message in displayMessages"
                :key="message.id"
                class="chat-message"
                :class="message.role"
                :style="participantStyle(message)"
              >
                <div
                  class="avatar"
                  :class="message.role === 'assistant' ? 'avatar-agent' : 'avatar-human'"
                >
                  {{ initials(authorName(message)) }}
                </div>
                <div class="message-body">
                  <div class="message-meta">
                    <strong>{{ authorName(message) }}</strong>
                    <span
                      class="role-tag"
                      :class="message.role === 'assistant' ? 'agent-tag' : 'human-tag'"
                      >{{ message.role === 'assistant' ? 'agent' : 'human' }}</span
                    >
                    <span v-if="message.state === 'pending'" class="pending-tag">sending</span>
                    <span v-if="message.harness" class="harness-tag"
                      >{{ message.harness
                      }}<template v-if="message.model"> · {{ message.model }}</template></span
                    >
                    <time>{{ formatTime(message.createdAt) }}</time>
                  </div>
                  <div v-if="message.text" class="message-text">{{ message.text }}</div>
                  <div v-else-if="message.state === 'streaming'" class="typing-indicator">
                    <span></span><span></span><span></span>
                  </div>
                  <div v-if="message.state === 'failed'" class="message-error">
                    The agent stopped before finishing.
                  </div>
                </div>
              </article>
            </div>
          </div>

          <form class="composer" @submit.prevent="sendDraft">
            <div class="mention-menu" v-if="mentionOptions.length">
              <button
                v-for="agent in mentionOptions"
                :key="agent.id"
                type="button"
                @click="insertMention(agent)"
              >
                <span class="mention-dot"></span><strong>@{{ agent.id }}</strong
                ><small
                  >{{ agent.name }} · {{ ownerName(agent.ownerId) }} · {{ agent.harness }}</small
                >
              </button>
            </div>
            <textarea
              v-model="draft"
              aria-label="Message"
              rows="2"
              :placeholder="members.length > 1 ? 'Message... Type @ to mention an agent' : 'Message...'"
              :disabled="!selectedRoom"
              @keydown.enter.exact.prevent="sendDraft"
            ></textarea>
            <div class="composer-footer">
              <div class="composer-controls"><select :value="composerProjectPath" aria-label="Project" @change="changeComposerProject(($event.target as HTMLSelectElement).value)"><option value="">Choose project</option><option v-for="project in composerProjects" :key="String(project.path)" :value="String(project.path)">{{ projectName(project) }}</option></select></div>
              <button
                class="send-button"
                type="submit"
                :disabled="!selectedRoom || !draft.trim() || sending"
                aria-label="Send message"
              >
                <LoaderCircle v-if="sending" :size="16" class="spin" /><Send v-else :size="16" />
              </button>
            </div>
          </form>
        </template>
      </main>

      <aside
        class="right-sidebar"
        v-if="(selectedRoom || selectedNative || selectedProject) && !settingsOpen && rightOpen"
      >
        <div class="right-panel-header">
          <h2>People and agents</h2>
          <button
            class="small-icon-button"
            aria-label="Hide people and agents"
            @click="rightOpen = false"
          >
            <PanelRightClose :size="16" />
          </button>
        </div>
        <div class="right-section">
          <div class="right-heading">
            <h2>People</h2>
            <span>{{ !selectedRoom ? 1 : members.length }}</span>
          </div>
          <div v-if="!selectedRoom" class="participant-row">
            <span class="participant-avatar human-avatar" :style="hueStyle(settings.member?.id || 'local-owner', 'human')">{{ initials(settings.displayName || settings.member?.name || 'You') }}</span>
            <span class="participant-name">{{ settings.displayName || settings.member?.name || 'You' }}<small>owner</small></span>
            <span class="you-label">you</span>
          </div>
          <div v-for="member in !selectedRoom ? [] : members" :key="member.id" class="participant-row">
            <span class="participant-avatar human-avatar" :style="hueStyle(member.id, 'human')">{{
              initials(member.name)
            }}</span>
            <span class="participant-name"
              >{{ member.name }}<small v-if="member.role === 'owner'">owner</small></span
            >
            <span v-if="member.id === settings.member?.id" class="you-label">you</span>
          </div>
        </div>
        <div class="right-section">
          <div class="right-heading">
            <h2>Agents</h2>
            <button class="small-icon-button" title="Configure agents" @click="settingsOpen = true">
              <Settings2 :size="14" />
            </button>
          </div>
          <div v-if="!selectedRoom" class="participant-row">
            <span class="participant-avatar agent-avatar" :style="hueStyle(selectedNative?.agentId || selectedNative?.harness || newChatHarness, 'agent')"><Bot :size="15" /></span>
            <span class="participant-name">{{ selectedNative?.agent || harnessLabel(selectedNative?.harness || newChatHarness) }}<small>on this computer</small></span>
          </div>
          <div v-for="agent in !selectedRoom ? [] : agents" :key="agent.id" class="participant-row">
            <span class="participant-avatar agent-avatar" :style="hueStyle(agent.id, 'agent')"
              ><Bot :size="15"
            /></span>
            <span class="participant-name"
              >{{ agent.name
              }}<small
                >{{ ownerName(agent.ownerId) }} · {{ agent.harness
                }}<template v-if="agent.model"> · {{ agent.model }}</template></small
              ></span
            >
            <span v-if="agentStates[agent.id]" class="agent-state" :class="agentStates[agent.id]">{{
              agentStates[agent.id] === 'working' ? 'working' : 'queued'
            }}</span>
          </div>
          <p v-if="selectedRoom && !agents.length" class="sidebar-note">Add a local agent in Settings.</p>
        </div>
        <div v-if="!selectedNative && selectedRoom" class="right-section room-rule">
          <p>
            {{ members.length === 1 ? 'Your agent answers ordinary messages.' : 'Tag an agent with @' + exampleAgent + ' to ask it to act.' }}
          </p>
        </div>
      </aside>
    </div>

    <ChatDialog v-if="inviteOpen" title="Invite friend" return-focus=".room-actions [aria-label='Invite friend']" @close="inviteOpen = false">
      <div class="invite-content">
        <p class="dialog-context">{{ inviteChatTitle }}</p>
        <p>Copy this code and send it to your friend. They can paste it into Join a chat.</p>
        <p v-if="inviting" class="dialog-context" role="status"><LoaderCircle :size="15" class="spin" />Creating invite code...</p>
        <label v-if="inviteKey">Chat invite code
          <div class="invite-code-row">
            <input :value="inviteKey" aria-label="Chat invite code" readonly spellcheck="false" />
            <button type="button" class="primary-button" :disabled="inviteCopying" @click="copyInviteCode">
              <Check v-if="inviteCopied" :size="15" /><Copy v-else :size="15" />{{ inviteCopied ? 'Copied' : 'Copy code' }}
            </button>
          </div>
        </label>
        <span class="sr-only" role="status" aria-live="polite">{{ inviteCopied ? 'Invite code copied to your clipboard' : '' }}</span>
        <p v-if="inviteError" class="dialog-error" role="alert">{{ inviteError }}</p>
        <button v-if="inviteError && !inviteKey" type="button" class="outline-button invite-retry" :disabled="inviting" @click="retryInvite">Try again</button>
      </div>
    </ChatDialog>

    <ChatDialog v-if="joinOpen" title="Join chat" return-focus=".room-actions [aria-label='Join a chat']" @close="joinOpen = false">
      <form class="join-form" aria-label="Join chat" @submit.prevent="submitJoinChat">
        <label>Invite code<input v-model="joinDraft" aria-label="Invite code" autocomplete="off" autofocus required /></label>
        <label v-if="!settings.connected">Name<input v-model="joinName" aria-label="Your name" autocomplete="name" required /></label>
        <p v-if="joinError" class="dialog-error" role="alert">{{ joinError }}</p>
        <div class="dialog-actions">
          <button type="button" class="outline-button" @click="joinOpen = false">Cancel</button>
          <button type="submit" class="primary-button" :disabled="joining || !joinDraft.trim() || (!settings.connected && !joinName.trim())">{{ joining ? 'Joining...' : 'Join chat' }}</button>
        </div>
      </form>
    </ChatDialog>

    <div v-if="permissionRequest" class="modal-backdrop">
      <section class="permission-modal">
        <div class="settings-header">
          <div>
            <p class="eyebrow">{{ permissionRequest.harness }} PERMISSION</p>
            <h2>{{ permissionRequest.title }}</h2>
          </div>
          <button class="icon-button" @click="resolvePermission(false)"><X :size="18" /></button>
        </div>
        <pre v-if="permissionRequest.detail">{{ permissionRequest.detail }}</pre>
        <div class="modal-actions">
          <button class="outline-button" @click="resolvePermission(false)">Decline</button
          ><button class="primary-button" @click="resolvePermission(true)">Allow once</button>
        </div>
      </section>
    </div>

    <div v-if="notice" class="toast" role="status">{{ notice }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  ArrowLeft,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FolderOpen,
  LoaderCircle,
  LogIn,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  UserPlus,
  X,
} from 'lucide-vue-next';
import ChatDialog from '../components/ChatDialog.vue';
import { filterLocalConversations } from '../lib/catalog-filters';
import { projectPathForConversation } from '../lib/project-chats';
import { displayTranscriptMessages } from '../lib/native-transcript';

type LocalConversation = {
  id: string;
  harness: string;
  title: string;
  path?: string;
  agent?: string;
  agentId?: string;
  updatedAt?: string;
  messageCount?: number;
  compacted?: boolean;
};
type LocalProject = Record<string, unknown>;
type NativeMessage = { role: string; content: string; at?: string };
type AgentState = 'queued' | 'working';
type PermissionRequest = {
  harness: 'codex' | 'hermes';
  id: number | string;
  method: string;
  title: string;
  detail: string;
  sessionId?: string;
  options?: { optionId: string; name: string }[];
};

const api = window.surprisedFace;
const settings = ref<SurprisedFaceSettings>({
  backendUrl: '',
  displayName: '',
  member: null,
  theme: 'mint-charcoal',
  allowRemoteAgentRequests: false,
  agents: [],
  connected: false,
});
const settingsDraft = ref<{
  backendUrl: string;
  displayName: string;
  theme: SurprisedFaceSettings['theme'];
}>({ backendUrl: '', displayName: '', theme: 'mint-charcoal' });
const allowAgentRuns = ref(false);
const settingsOpen = ref(false);
const leftOpen = ref(true);
const rightOpen = ref(true);
const projectsExpanded = ref(true);
const visibleProjectCount = ref(80);
const visibleConversationCount = ref(80);
const catalogQuery = ref('');
const harnessFilter = ref('');
const agentFilter = ref('');
const settingsSaved = ref(false);
const settingsSaving = ref(false);
const settingsSaveError = ref('');
let settingsReady = false;
let settingsSaveTimer: ReturnType<typeof setTimeout> | undefined;
const rooms = ref<SharedRoom[]>([]);
const members = ref<SharedMember[]>([]);
const agents = ref<SharedAgent[]>([]);
const messages = ref<SharedMessage[]>([]);
const roomAgentIds = ref<Record<string, string[]>>({});
const roomHarnesses = ref<Record<string, string[]>>({});
const pendingOutbox = ref<PendingLocalMessage[]>([]);
const currentRoomId = ref('');
let roomSelection = 0;
let roomReadVersion = 0;
const selectedProject = ref<LocalProject | null>(null);
const projects = ref<LocalProject[]>([]);
const conversations = ref<LocalConversation[]>([]);
const selectedNative = ref<LocalConversation | null>(null);
const newChatHarness = ref<'codex' | 'hermes'>('codex');
const nativeTranscript = ref<unknown>(null);
const nativeDraft = ref('');
const nativeSending = ref(false);
const nativeAddedMessages = ref<NativeMessage[]>([]);
const nativeViewport = ref<HTMLElement | null>(null);
const nativeError = ref('');
const nativeMessages = computed<NativeMessage[]>(() => {
  return displayTranscriptMessages(nativeTranscript.value);
});
const nativeDisplayMessages = computed(() => [...nativeMessages.value, ...nativeAddedMessages.value]);
const nativeChatSupported = computed(() => !selectedNative.value || selectedNative.value.harness === 'codex' || selectedNative.value.harness === 'hermes');
const nativeCanSend = computed(() => nativeChatSupported.value && !nativeSending.value && Boolean(selectedNative.value?.path || selectedProject.value?.path));
const composerProjectPath = computed(() => selectedNative.value
  ? projectPathForConversation(selectedNative.value.path, projects.value) || selectedNative.value.path || ''
  : string(selectedProject.value?.path));
const composerProjects = computed(() => {
  const choices = projects.value.filter((project) => string(project.path));
  const path = composerProjectPath.value;
  return path && !choices.some((project) => project.path === path) ? [...choices, { path, name: path.split('/').at(-1) }] : choices;
});
const nativeLoading = ref(false);
const catalogLoading = ref(false);
const catalogLoaded = ref(false);
const catalogError = ref('');
const currentError = ref('');
const connectionError = ref('');
const harnessError = ref('');
const inviteCode = ref('');
const inviting = ref(false);
const inviteOpen = ref(false);
const inviteKey = ref('');
const inviteChatTitle = ref('');
const inviteError = ref('');
const inviteCopying = ref(false);
const inviteCopied = ref(false);
const joinOpen = ref(false);
const joinDraft = ref('');
const joinName = ref('');
const joinError = ref('');
const joining = ref(false);
const connecting = ref(false);
const savingAgent = ref(false);
const sending = ref(false);
const draft = ref('');
const selectedAgentDraft = ref(0);
const agentDrafts = ref<
  {
    id: string;
    name: string;
    harness: 'codex' | 'hermes';
    model: string;
    workingDirectory: string;
  }[]
>([]);
const agentStates = ref<Record<string, AgentState>>({});
const connectedRoomIds = ref(new Set<string>());
const activeAgentName = computed(() => {
  const id = Object.entries(agentStates.value).find(([, state]) => state === 'working')?.[0];
  return id ? agents.value.find((agent) => agent.id === id)?.name || 'Agent' : '';
});
const queuedAgentNames = computed(() =>
  Object.entries(agentStates.value)
    .filter(([, state]) => state === 'queued')
    .map(([id]) => agents.value.find((agent) => agent.id === id)?.name || id),
);
const permissionRequest = ref<PermissionRequest | null>(null);
const notice = ref('');
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
const codexStatus = ref('Not checked');
const codexAccountState = ref<'unknown' | 'signed-in' | 'signed-out' | 'not-required'>('unknown');
const codexBusy = ref<'' | 'checking' | 'signing-in' | 'signing-out'>('');
const codexFeedback = ref('');
const codexError = ref('');
const codexLoginPending = ref(false);
let codexLoginId = '';
let codexRefreshPending = false;
const hermesStatusText = ref('');
const messageViewport = ref<HTMLElement | null>(null);
const unsubscribers: (() => void)[] = [];
const selectedRoom = computed(
  () => rooms.value.find((room) => room.id === currentRoomId.value) || null,
);
const displayMessages = computed<SharedMessage[]>(() => {
  const pending = pendingOutbox.value.map(
    (item): SharedMessage => ({
      id: `local:${item.client_id}`,
      roomId: item.room_id,
      messageSeq: Number.MAX_SAFE_INTEGER,
      participantId: settings.value.member?.id || '',
      participantName: settings.value.member?.name || settings.value.displayName,
      role: 'user',
      text: item.text,
      state: 'pending',
      agentId: null,
      agentName: null,
      ownerId: null,
      harness: null,
      model: null,
      createdAt: item.created_at,
      updatedAt: item.created_at,
    }),
  );
  return [...messages.value, ...pending].sort(
    (left, right) =>
      left.messageSeq - right.messageSeq || left.createdAt.localeCompare(right.createdAt),
  );
});
const harnessOptions = computed(() =>
  [...new Set(conversations.value.map((item) => item.harness).filter(Boolean))].sort(),
);
const agentOptions = computed(() => {
  const choices = new Map<string, string>();
  for (const agent of agents.value) choices.set(agent.id, agent.name);
  for (const conversation of conversations.value) {
    if (conversation.agentId)
      choices.set(conversation.agentId, conversation.agent || conversation.agentId);
    else if (conversation.agent) choices.set(conversation.agent, conversation.agent);
  }
  return [...choices]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
});
const filteredProjects = computed(() =>
  projects.value.filter((project) => {
    const query = catalogQuery.value.trim().toLowerCase();
    if (query && !`${projectName(project)} ${string(project.path)}`.toLowerCase().includes(query) &&
      !conversations.value.some((item) => belongsToProject(item, project) && item.title.toLowerCase().includes(query)))
      return false;
    if (
      harnessFilter.value &&
      string(project.harness) !== harnessFilter.value &&
      !conversations.value.some(
        (item) => item.harness === harnessFilter.value && belongsToProject(item, project),
      )
    )
      return false;
    if (
      agentFilter.value &&
      !conversations.value.some(
        (item) =>
          belongsToProject(item, project) &&
          (item.agent === agentFilter.value || item.agentId === agentFilter.value),
      )
    )
      return false;
    return true;
  }),
);
const visibleProjects = computed(() => filteredProjects.value.slice(0, visibleProjectCount.value));
const filteredRooms = computed(() =>
  rooms.value.filter(
    (room) =>
      (!catalogQuery.value.trim() ||
        room.name.toLowerCase().includes(catalogQuery.value.trim().toLowerCase())) &&
      (!agentFilter.value || roomAgentIds.value[room.id]?.includes(agentFilter.value)) &&
      (!harnessFilter.value || roomHarnesses.value[room.id]?.includes(harnessFilter.value)),
  ),
);
const filteredConversations = computed(() =>
  filterLocalConversations(conversations.value, {
    query: catalogQuery.value,
    harness: harnessFilter.value,
    agent: agentFilter.value,
    projectPath: '',
  }),
);
const unfiledConversations = computed(() => filteredConversations.value.filter((item) =>
  !projects.value.some((project) => belongsToProject(item, project)),
));
const activeAgentDraft = computed(() => agentDrafts.value[selectedAgentDraft.value]);
const canJoin = computed(() =>
  Boolean(
    settingsDraft.value.backendUrl.trim() &&
    (settings.value.connected || settingsDraft.value.displayName.trim()) &&
    inviteCode.value.trim(),
  ),
);
const canSaveAgent = computed(() =>
  Boolean(
    activeAgentDraft.value?.id.trim() &&
    activeAgentDraft.value?.name.trim() &&
    activeAgentDraft.value?.workingDirectory.trim(),
  ),
);
const mentionOptions = computed(() => {
  if (!selectedRoom.value) return [];
  const match = /(?:^|\s)@([a-z0-9-]*)$/i.exec(draft.value);
  if (!match) return [];
  const search = (match[1] || '').toLowerCase();
  return agents.value
    .filter(
      (agent) =>
        agent.id.toLowerCase().startsWith(search) || agent.name.toLowerCase().startsWith(search),
    )
    .slice(0, 8);
});
const exampleAgent = computed(() => agents.value[0]?.id || 'agent-name');
const themeOptions = [
  { value: 'cobalt-red', label: 'Cobalt + red' },
  { value: 'mint-charcoal', label: 'Mint + charcoal' },
  { value: 'classic', label: 'Classic' },
] as const;

watch([() => settingsDraft.value.theme, () => settingsDraft.value.displayName, allowAgentRuns], () => {
  if (!settingsReady || !generalSettingsChanged()) return;
  settingsSaved.value = false;
  if (settingsSaveTimer) clearTimeout(settingsSaveTimer);
  settingsSaveTimer = setTimeout(() => void saveGeneralSettings(), 250);
});
watch(settingsOpen, (open) => { if (open) void checkCodex(false, false); });
watch([catalogQuery, harnessFilter, agentFilter, selectedProject], () => {
  visibleProjectCount.value = 80;
  visibleConversationCount.value = 80;
});
watch([catalogQuery, harnessFilter, agentFilter], () => {
  if (catalogQuery.value.trim()) projectsExpanded.value = true;
});
watch(messages, () => void scrollToBottom(), { deep: true });

onMounted(async () => {
  try {
    settings.value = await api.settings();
    settingsDraft.value = {
      backendUrl: settings.value.backendUrl,
      displayName: settings.value.displayName,
      theme: settings.value.theme,
    };
    allowAgentRuns.value = settings.value.allowRemoteAgentRequests;
    settingsReady = true;
    agentDrafts.value = settings.value.agents.length
      ? settings.value.agents.map((agent) => ({ ...agent }))
      : [blankAgent(settings.value.displayName)];
    void refreshCatalog();
    catalogTimer = window.setInterval(() => {
      void refreshCatalog();
    }, 60_000);
    if (settings.value.connected) await loadWorkspace();
  } catch (error) {
    showError(error);
  }
  unsubscribers.push(api.onRoomEvent(handleRoomEvent));
  unsubscribers.push(api.onOutboxChanged((value) => {
    const roomId = string(object(value)?.roomId);
    if (roomId === currentRoomId.value) refreshRoomMessages(roomId);
  }));
  unsubscribers.push(api.onRoomConnection(handleRoomConnection));
  unsubscribers.push(api.onAppError(showError));
  unsubscribers.push(api.onAgentActivity(handleAgentActivity));
  unsubscribers.push(api.onCodexRequest(handleCodexRequest));
  unsubscribers.push(api.onCodexEvent(handleCodexAccountEvent));
  unsubscribers.push(api.onHermesRequest(handleHermesRequest));
  unsubscribers.push(api.onNativeChatEvent(handleNativeChatEvent));
  window.addEventListener('focus', refreshCodexOnFocus);
});

onUnmounted(() => {
  for (const unsubscribe of unsubscribers) unsubscribe();
  if (catalogTimer) window.clearInterval(catalogTimer);
  if (noticeTimer) clearTimeout(noticeTimer);
  if (settingsSaveTimer) clearTimeout(settingsSaveTimer);
  window.removeEventListener('focus', refreshCodexOnFocus);
});
let catalogTimer: number | null = null;

async function loadWorkspace(): Promise<void> {
  try {
    const roomRows = await api.rooms();
    rooms.value = roomRows;
    const snapshots = await Promise.all(roomRows.map((room) => api.roomMessages(room.id)));
    roomAgentIds.value = Object.fromEntries(
      roomRows.map((room, index) => [
        room.id,
        [
          ...new Set(
            (snapshots[index] || []).map((item) => item.agentId).filter((id): id is string => !!id),
          ),
        ],
      ]),
    );
    roomHarnesses.value = Object.fromEntries(
      roomRows.map((room, index) => [
        room.id,
        [
          ...new Set(
            (snapshots[index] || [])
              .map((item) => item.harness)
              .filter((name): name is string => !!name),
          ),
        ],
      ]),
    );
    const current = roomRows.find((room) => room.id === currentRoomId.value);
    if (current) await selectRoom(current);
    else if (roomRows[0]) await selectRoom(roomRows[0]);
  } catch (error) {
    showError(error);
  }
}

async function refreshCatalog(): Promise<void> {
  if (catalogLoading.value) return;
  catalogLoading.value = true;
  catalogError.value = '';
  try {
    const result = await api.sheepRefresh();
    projects.value = result.projects || [];
    const activeProject = selectedProject.value;
    if (activeProject && !projects.value.some((project) => projectKey(project) === projectKey(activeProject)))
      selectedProject.value = null;
    conversations.value = (result.conversations || []) as LocalConversation[];
    if (result.conversationSourceError) catalogError.value = result.conversationSourceError;
    catalogLoaded.value = true;
  } catch (error) {
    catalogError.value = messageOf(error)
      .replace(/Sheep/g, 'Local catalog')
      .replace(/sheep/g, 'local catalog');
  } finally {
    catalogLoading.value = false;
  }
}

function selectProject(project: LocalProject): void {
  if (nativeSending.value) return;
  if (selectedProject.value && projectKey(selectedProject.value) === projectKey(project)) selectedProject.value = null;
  else newRoom(project);
}

async function selectRoom(room: SharedRoom): Promise<void> {
  settingsOpen.value = false;
  selectedNative.value = null;
  currentRoomId.value = room.id;
  const selection = ++roomSelection;
  const readVersion = ++roomReadVersion;
  try {
    const [rows, pending, roomMembers, roomAgents] = await Promise.all([
      api.openRoom(room.id), api.pendingMessages(room.id), api.members(room.id), api.agents(room.id),
    ]);
    if (selection !== roomSelection || currentRoomId.value !== room.id) return;
    members.value = roomMembers;
    agents.value = roomAgents;
    if (readVersion === roomReadVersion) {
      messages.value = rows;
      roomAgentIds.value[room.id] = [
        ...new Set(rows.map((item) => item.agentId).filter((id): id is string => !!id)),
      ];
      roomHarnesses.value[room.id] = [
        ...new Set(rows.map((item) => item.harness).filter((name): name is string => !!name)),
      ];
      pendingOutbox.value = pending;
    }
    await api.runPending(room.id);
    await scrollToBottom();
  } catch (error) {
    showError(error);
  }
}

function newRoom(project: LocalProject | null = selectedProject.value): void {
  if (nativeSending.value) return;
  if (selectedNative.value?.harness === 'codex' || selectedNative.value?.harness === 'hermes') newChatHarness.value = selectedNative.value.harness;
  selectedProject.value = project;
  settingsOpen.value = false;
  selectedNative.value = null;
  currentRoomId.value = '';
  nativeTranscript.value = null;
  nativeAddedMessages.value = [];
  nativeDraft.value = '';
  nativeError.value = '';
  void nextTick(() => document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus());
}

function changeComposerProject(path: string): void {
  const project = composerProjects.value.find((item) => item.path === path);
  if (!project || path === composerProjectPath.value) return;
  const text = selectedRoom.value ? draft.value : nativeDraft.value;
  newRoom(project);
  nativeDraft.value = text;
}

async function openNativeConversation(conversation: LocalConversation): Promise<void> {
  if (settings.value.connected) {
    const link = await api.nativeLink({ harness: conversation.harness, sessionId: conversation.id });
    const room = link && rooms.value.find((item) => item.id === link.roomId);
    if (room) return selectRoom(room);
  }
  settingsOpen.value = false;
  currentRoomId.value = '';
  const projectPath = projectPathForConversation(conversation.path, projects.value);
  selectedProject.value = projects.value.find((project) => project.path === projectPath) || null;
  selectedNative.value = conversation;
  nativeTranscript.value = null;
  nativeAddedMessages.value = [];
  nativeDraft.value = '';
  nativeSending.value = false;
  nativeError.value = '';
  await loadNativeTranscript();
}

async function sendNativeDraft(): Promise<void> {
  const text = nativeDraft.value.trim();
  if (!text || !nativeCanSend.value) return;
  nativeError.value = '';
  nativeSending.value = true;
  try {
    if (!selectedNative.value) {
      const conversation = await api.nativeCreate({ harness: newChatHarness.value, cwd: string(selectedProject.value?.path), title: text.slice(0, 80) });
      selectedNative.value = conversation;
      nativeTranscript.value = { messages: [] };
      conversations.value = [conversation, ...conversations.value.filter((item) => conversationKey(item) !== conversationKey(conversation))];
      if (selectedProject.value) projects.value = [selectedProject.value, ...projects.value.filter((item) => projectKey(item) !== projectKey(selectedProject.value!))];
    }
    const conversation = selectedNative.value;
    nativeDraft.value = '';
    nativeAddedMessages.value.push({ role: 'user', content: text, at: new Date().toISOString() });
    nativeAddedMessages.value.push({ role: 'assistant', content: '', at: new Date().toISOString() });
    await scrollNativeToBottom();
    await api.nativeSend({ harness: conversation.harness as 'codex' | 'hermes', sessionId: conversation.id, cwd: conversation.path || string(selectedProject.value?.path), text });
  } catch (error) {
    nativeError.value = messageOf(error);
    nativeSending.value = false;
  }
}

function handleNativeChatEvent(value: unknown): void {
  const event = object(value);
  const conversation = selectedNative.value;
  if (!conversation || string(event?.sessionId) !== conversation.id || string(event?.harness) !== conversation.harness) return;
  if (event?.type === 'delta') {
    const reply = nativeAddedMessages.value.at(-1);
    if (reply?.role === 'assistant') reply.content += string(event.text);
    void scrollNativeToBottom();
  } else if (event?.type === 'transcript' && Array.isArray(event.messages)) {
    nativeTranscript.value = { messages: event.messages };
    const sent = nativeAddedMessages.value.find((item) => item.role === 'user')?.content.trim();
    const rows = event.messages.filter((item): item is { role?: unknown; content?: unknown } => Boolean(item) && typeof item === 'object');
    if (sent && rows.some((item) => item.role === 'user' && typeof item.content === 'string' && item.content.trim() === sent)) {
      nativeAddedMessages.value = [];
    }
    void scrollNativeToBottom();
  } else if (event?.type === 'completed') nativeSending.value = false;
  else if (event?.type === 'failed') {
    nativeSending.value = false;
    nativeError.value = string(event.message) || 'The agent could not finish.';
  }
}

async function shareNativeConversation(): Promise<void> {
  const conversation = selectedNative.value;
  if (!conversation) return;
  if (!nativeChatSupported.value || !conversation.path) {
    nativeError.value = 'This chat needs a Codex or Hermes session with a working folder before inviting.';
    return;
  }
  beginInvite(conversation.title || 'Chat');
  nativeError.value = '';
  try {
    if (!settings.value.connected) {
      await api.register(settingsDraft.value.displayName.trim());
      settings.value = await api.settings();
      await loadWorkspace();
    }
    const result = await api.nativeShare({
      harness: conversation.harness as 'codex' | 'hermes', sessionId: conversation.id,
      cwd: conversation.path, title: conversation.title || 'Chat',
      ...(conversation.agent ? { agentName: conversation.agent } : {}),
    });
    rooms.value = [...rooms.value.filter((room) => room.id !== result.room.id), result.room];
    await selectRoom(result.room);
    setInviteCode(result.invite?.code);
  } catch (error) { inviteError.value = messageOf(error); }
  finally { inviting.value = false; }
}

async function loadNativeTranscript(): Promise<void> {
  if (!selectedNative.value) return;
  nativeLoading.value = true;
  nativeError.value = '';
  try {
    nativeTranscript.value = await api.sheepRead({
      harness: selectedNative.value.harness,
      id: selectedNative.value.id,
    });
    if (selectedNative.value.harness === 'codex') void api.nativeFollow({ sessionId: selectedNative.value.id });
  } catch (error) {
    nativeError.value = messageOf(error)
      .replace(/Sheep/g, 'Local catalog')
      .replace(/sheep/g, 'local catalog');
  } finally {
    nativeLoading.value = false;
  }
  await scrollNativeToBottom();
}

async function scrollNativeToBottom(): Promise<void> {
  await nextTick();
  if (nativeViewport.value) nativeViewport.value.scrollTop = nativeViewport.value.scrollHeight;
}

function insertMention(agent: SharedAgent): void {
  draft.value = draft.value.replace(
    /(?:^|\s)@([a-z0-9-]*)$/i,
    (match) => `${match.startsWith(' ') ? ' ' : ''}@${agent.id} `,
  );
}

async function sendDraft(): Promise<void> {
  if (!selectedRoom.value || !draft.value.trim() || sending.value) return;
  const roomId = selectedRoom.value.id;
  const text = draft.value.trim();
  const mentions = [...text.matchAll(/(?:^|\s)@([a-z0-9][a-z0-9-]*)/gi)].map((match) =>
    (match[1] || '').toLowerCase(),
  );
  const agentIds = [
    ...new Set(
      mentions.filter((id) => agents.value.some((agent) => agent.id.toLowerCase() === id)),
    ),
  ];
  sending.value = true;
  draft.value = '';
  try {
    await api.sendMessage({ roomId, text, ...(agentIds.length ? { agentIds } : {}) });
    const readVersion = ++roomReadVersion;
    const [pending, rows] = await Promise.all([
      api.pendingMessages(roomId),
      api.roomMessages(roomId),
    ]);
    if (currentRoomId.value !== roomId || readVersion !== roomReadVersion) return;
    pendingOutbox.value = pending;
    messages.value = rows;
    await scrollToBottom();
  } catch (error) {
    draft.value = text;
    showError(error);
  } finally {
    sending.value = false;
  }
}

function handleRoomEvent(value: unknown): void {
  const payload = object(value);
  const roomId = string(payload?.roomId);
  const event = object(payload?.event);
  if (!event || !roomId) return;
  const agentId = string(event.agentId) || '';
  if (event.type === 'turn.queued' && agentId) agentStates.value[agentId] = 'queued';
  if (event.type === 'turn.started' && agentId) agentStates.value[agentId] = 'working';
  if (event.type === 'turn.finished' && agentId) delete agentStates.value[agentId];
  if (roomId === currentRoomId.value && (event.type === 'member.joined' || event.type === 'agent.updated')) {
    void Promise.all([api.members(roomId), api.agents(roomId)])
      .then(([roomMembers, roomAgents]) => {
        if (roomId !== currentRoomId.value) return;
        members.value = roomMembers;
        agents.value = roomAgents;
      }).catch(showError);
  }
  if (roomId === currentRoomId.value) refreshRoomMessages(roomId);
}

function refreshRoomMessages(roomId: string): void {
  if (roomId === currentRoomId.value) {
    const selection = roomSelection;
    const readVersion = ++roomReadVersion;
    void Promise.all([api.roomMessages(roomId), api.pendingMessages(roomId)])
      .then(([rows, pending]) => {
        if (
          selection !== roomSelection ||
          readVersion !== roomReadVersion ||
          roomId !== currentRoomId.value
        )
          return;
        messages.value = rows;
        roomAgentIds.value[roomId] = [
          ...new Set(rows.map((item) => item.agentId).filter((id): id is string => !!id)),
        ];
        roomHarnesses.value[roomId] = [
          ...new Set(rows.map((item) => item.harness).filter((name): name is string => !!name)),
        ];
        pendingOutbox.value = pending;
      })
      .catch(showError);
  }
}

function handleRoomConnection(value: unknown): void {
  const payload = object(value);
  const roomId = string(payload?.roomId);
  const state = string(payload?.state);
  if (!roomId) return;
  const next = new Set(connectedRoomIds.value);
  if (state === 'connected') next.add(roomId);
  else next.delete(roomId);
  connectedRoomIds.value = next;
}

function handleAgentActivity(value: unknown): void {
  const activity = object(value);
  if (activity?.event && object(activity.event)?.type === 'tool') {
    const tool = object(activity.event);
    if (tool?.status === 'completed' || tool?.status === 'failed')
      showNotice(`${string(tool.title) || 'Agent tool'} ${string(tool.status)}.`);
  }
}

function handleCodexRequest(value: unknown): void {
  const wrapper = object(value);
  const request = object(wrapper?.request) || wrapper;
  if (!request) return;
  const params = object(request.params);
  permissionRequest.value = {
    harness: 'codex',
    id: request.id as number | string,
    method: string(request.method) || 'Codex permission',
    title:
      string(params?.command) || string(params?.reason) || 'Codex needs permission to continue.',
    detail: string(params?.command) || string(params?.reason) || '',
  };
}

function handleHermesRequest(value: unknown): void {
  const request = object(value);
  if (!request) return;
  permissionRequest.value = {
    harness: 'hermes',
    id: string(request.requestId) || '',
    method: 'session/request_permission',
    title: string(request.title) || 'Hermes needs permission',
    detail: string(request.detail) || '',
    sessionId: string(request.sessionId) || '',
    options: Array.isArray(request.options)
      ? (request.options as { optionId: string; name: string }[])
      : [],
  };
}

async function resolvePermission(approved: boolean): Promise<void> {
  const request = permissionRequest.value;
  if (!request) return;
  permissionRequest.value = null;
  if (request.harness === 'hermes') {
    const option = approved
      ? request.options?.find((item) => /allow|once|approve/i.test(item.name)) ||
        request.options?.[0]
      : null;
    await api.hermesPermission({ requestId: request.id, optionId: option?.optionId || null });
  } else {
    const decision = approved ? 'accept' : 'decline';
    const result = request.method.includes('permissions')
      ? { permissions: {}, scope: 'turn' }
      : { decision };
    await api.codexServerResponse({ requestId: request.id, result });
  }
}

async function joinWorkspace(): Promise<void> {
  connecting.value = true;
  connectionError.value = '';
  try {
    await acceptChatCode(inviteCode.value.trim(), settingsDraft.value.displayName.trim());
    inviteCode.value = '';
    showNotice('Joined chat.');
  } catch (error) {
    connectionError.value = messageOf(error);
  } finally {
    connecting.value = false;
  }
}

async function logout(): Promise<void> {
  settings.value = await api.logout();
  rooms.value = [];
  members.value = [];
  agents.value = [];
  messages.value = [];
  currentRoomId.value = '';
}

function joinChat(): void {
  joinDraft.value = '';
  joinName.value = settings.value.displayName || settingsDraft.value.displayName;
  joinError.value = '';
  joinOpen.value = true;
}

async function acceptChatCode(code: string, name: string): Promise<void> {
  let roomId = '';
  const before = new Set(rooms.value.map((room) => room.id));
  if (settings.value.connected) roomId = (await api.joinRoom(code)).roomId;
  else {
    await api.join({ backendUrl: settings.value.backendUrl, code, name });
    settings.value = await api.settings();
  }
  await loadWorkspace();
  const room = rooms.value.find((item) => item.id === roomId) || rooms.value.find((item) => !before.has(item.id));
  if (room) await selectRoom(room);
}

async function submitJoinChat(): Promise<void> {
  if (joining.value || !joinDraft.value.trim()) return;
  joining.value = true;
  joinError.value = '';
  try {
    await acceptChatCode(joinDraft.value.trim(), joinName.value.trim());
    joinOpen.value = false;
    showNotice('Joined chat');
  } catch (error) { joinError.value = messageOf(error); }
  finally { joining.value = false; }
}

function beginInvite(title: string): void {
  inviteChatTitle.value = title;
  inviteKey.value = '';
  inviteError.value = '';
  inviteCopied.value = false;
  inviteOpen.value = true;
  inviting.value = true;
}

function setInviteCode(code: string | undefined): void {
  if (!code?.trim()) throw new Error('Could not create an invite code. Try again.');
  inviteKey.value = code;
}

async function createRoomInvite(): Promise<void> {
  const room = selectedRoom.value;
  if (!room || inviting.value) return;
  beginInvite(room.name || 'Chat');
  try {
    const invite = (await api.createInvites(room.id))[0];
    setInviteCode(invite?.code);
  } catch (error) { inviteError.value = messageOf(error); }
  finally { inviting.value = false; }
}

async function retryInvite(): Promise<void> {
  if (selectedNative.value) await shareNativeConversation();
  else await createRoomInvite();
}

async function copyInviteCode(): Promise<void> {
  if (!inviteKey.value || inviteCopying.value) return;
  const code = inviteKey.value;
  inviteCopying.value = true;
  inviteError.value = '';
  try {
    const result = await api.copyText(code);
    if (!result.ok) throw new Error('Could not copy the invite code. Try again.');
    if (inviteKey.value === code) inviteCopied.value = true;
  } catch (error) {
    if (inviteKey.value === code) inviteError.value = messageOf(error);
  } finally { inviteCopying.value = false; }
}

function generalSettingsInput() {
  return {
    displayName: settingsDraft.value.displayName.trim().replace(/\s+/g, ' '),
    theme: settingsDraft.value.theme,
    allowRemoteAgentRequests: allowAgentRuns.value,
  };
}

function generalSettingsChanged(): boolean {
  const input = generalSettingsInput();
  return input.displayName !== settings.value.displayName || input.theme !== settings.value.theme ||
    input.allowRemoteAgentRequests !== settings.value.allowRemoteAgentRequests;
}

async function saveGeneralSettings(): Promise<void> {
  if (!settingsReady || settingsSaving.value) return;
  if (settingsSaveTimer) clearTimeout(settingsSaveTimer);
  settingsSaving.value = true;
  settingsSaveError.value = '';
  settingsSaved.value = false;
  try {
    // Serialize writes and keep changes made while a previous save is in flight.
    while (generalSettingsChanged()) {
      const input = generalSettingsInput();
      settings.value = await api.updateSettings(input);
    }
    settingsSaved.value = true;
  } catch (error) {
    settingsSaveError.value = messageOf(error);
  } finally {
    settingsSaving.value = false;
  }
}

function blankAgent(displayName = '') {
  const stem = (displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'my').replace(
    /^-|-$/g,
    '',
  );
  return {
    id: `${stem}-agent`,
    name: `${displayName || 'My'} agent`,
    harness: 'codex' as const,
    model: '',
    workingDirectory: '',
  };
}

function addAgent(): void {
  agentDrafts.value.push(blankAgent(settings.value.displayName));
  selectedAgentDraft.value = agentDrafts.value.length - 1;
}

async function saveAgent(): Promise<void> {
  if (!activeAgentDraft.value || !canSaveAgent.value) return;
  savingAgent.value = true;
  try {
    settings.value = await api.saveAgent({ ...activeAgentDraft.value });
    agentDrafts.value = settings.value.agents.map((agent) => ({ ...agent }));
    if (selectedRoom.value) agents.value = await api.agents(selectedRoom.value.id);
    showNotice('Agent saved.');
  } catch (error) {
    connectionError.value = messageOf(error);
  } finally {
    savingAgent.value = false;
  }
}

async function chooseWorkingFolder(): Promise<void> {
  if (!activeAgentDraft.value) return;
  const folder = await api.chooseFolder();
  if (folder) activeAgentDraft.value.workingDirectory = folder;
}

async function readCodexAccount(refresh: boolean): Promise<void> {
  const response = object(await api.codexAccount(refresh));
  if (!response) throw new Error('Could not read the Codex account. Try checking status again.');
  const account = object(response.account);
  if (account) {
    codexAccountState.value = 'signed-in';
    codexStatus.value = account.type === 'apiKey' ? 'Signed in with an API key'
      : string(account.email) ? `Signed in as ${string(account.email)}` : 'Signed in';
    codexLoginPending.value = false;
  } else if (response.requiresOpenaiAuth === false) {
    codexAccountState.value = 'not-required';
    codexStatus.value = 'Authentication not required';
  } else {
    codexAccountState.value = 'signed-out';
    codexStatus.value = 'Not signed in';
  }
}

function finishCodexAction(): void {
  codexBusy.value = '';
  if (codexRefreshPending) {
    codexRefreshPending = false;
    void checkCodex(false, false);
  }
}

async function checkCodex(refresh = true, feedback = true): Promise<void> {
  if (codexBusy.value) {
    if (!feedback) codexRefreshPending = true;
    return;
  }
  codexBusy.value = 'checking';
  codexError.value = '';
  if (feedback) codexFeedback.value = 'Checking Codex status...';
  try {
    await readCodexAccount(refresh);
    if (feedback) codexFeedback.value = codexAccountState.value === 'signed-in'
      ? 'Codex status checked. You are signed in.'
      : codexAccountState.value === 'not-required' ? 'Codex status checked. Authentication is not required.'
      : codexLoginPending.value ? 'Complete Codex sign-in in your browser.'
      : 'Codex status checked. You are not signed in.';
  } catch (error) {
    codexError.value = messageOf(error);
    codexStatus.value = 'Status unavailable';
    codexAccountState.value = 'unknown';
    codexFeedback.value = '';
  } finally {
    finishCodexAction();
  }
}

async function signInCodex(): Promise<void> {
  if (codexBusy.value || codexLoginPending.value) return;
  codexBusy.value = 'signing-in';
  codexError.value = '';
  codexFeedback.value = 'Opening Codex sign-in...';
  try {
    const result = object(await api.codexLogin());
    codexLoginId = string(result?.loginId);
    codexLoginPending.value = Boolean(codexLoginId);
    codexFeedback.value = 'Complete Codex sign-in in your browser.';
    await readCodexAccount(false);
    if (codexAccountState.value === 'signed-in') codexFeedback.value = 'Signed in to Codex.';
  } catch (error) {
    codexError.value = messageOf(error);
    codexLoginPending.value = false;
    codexFeedback.value = '';
  } finally {
    finishCodexAction();
  }
}

async function signOutCodex(): Promise<void> {
  if (codexBusy.value) return;
  codexBusy.value = 'signing-out';
  codexError.value = '';
  codexFeedback.value = 'Signing out of Codex...';
  try {
    await api.codexLogout();
    codexLoginPending.value = false;
    codexLoginId = '';
    codexAccountState.value = 'signed-out';
    codexStatus.value = 'Not signed in';
    codexFeedback.value = 'Signed out of Codex.';
  } catch (error) {
    codexError.value = messageOf(error);
    codexFeedback.value = '';
  } finally {
    finishCodexAction();
  }
}

function handleCodexAccountEvent(value: unknown): void {
  const event = object(value);
  const params = object(event?.params);
  if (event?.method === 'account/login/completed') {
    if (codexLoginId && params?.loginId && params.loginId !== codexLoginId) return;
    codexLoginPending.value = false;
    codexLoginId = '';
    if (params?.success) {
      codexFeedback.value = 'Signed in to Codex.';
      void checkCodex(false, false);
    } else {
      codexError.value = string(params?.error) || 'Codex sign-in did not complete. Try again.';
      codexFeedback.value = '';
    }
  } else if (event?.method === 'account/updated') {
    void checkCodex(false, false);
  }
}

function refreshCodexOnFocus(): void {
  if (settingsOpen.value || codexLoginPending.value) void checkCodex(false, false);
}

async function checkHermes(): Promise<void> {
  harnessError.value = '';
  try {
    const status = object(await api.hermesStatus(true));
    hermesStatusText.value = status?.installed
      ? string(status.version) || 'Installed'
      : string(status?.message) || 'Not found';
  } catch (error) {
    harnessError.value = messageOf(error);
    hermesStatusText.value = 'Unavailable';
  }
}

async function scrollToBottom(): Promise<void> {
  await nextTick();
  if (messageViewport.value) messageViewport.value.scrollTop = messageViewport.value.scrollHeight;
}

function projectKey(project: LocalProject): string {
  return string(project.path) || string(project.name);
}
function belongsToProject(conversation: LocalConversation, project: LocalProject): boolean {
  return projectPathForConversation(conversation.path, projects.value) === string(project.path);
}
function projectConversations(project: LocalProject): LocalConversation[] {
  return filteredConversations.value.filter((conversation) => belongsToProject(conversation, project));
}
function projectName(project: LocalProject): string {
  return (
    string(project.alias) || string(project.name) || basename(string(project.path) || 'Project')
  );
}
function harnessLabel(harness: string): string {
  return harness === 'pi' ? 'Pi' : `${harness.charAt(0).toUpperCase()}${harness.slice(1)}`;
}
function conversationKey(conversation: LocalConversation): string {
  return `${conversation.harness}:${conversation.id}`;
}
function harnessInitial(harness: string): string {
  return (
    (
      { codex: 'C', claude: 'A', hermes: 'H', pi: 'P', opencode: 'O', antigravity: 'G' } as Record<
        string,
        string
      >
    )[harness] || harness.slice(0, 1).toUpperCase()
  );
}
function authorName(message: SharedMessage): string {
  if (message.role === 'assistant')
    return (
      message.agentName ||
      agents.value.find((agent) => agent.id === message.agentId)?.name ||
      'Agent'
    );
  return (
    message.participantName ||
    members.value.find((member) => member.id === message.participantId)?.name ||
    (message.participantId === settings.value.member?.id ? settings.value.displayName : 'Member')
  );
}
function ownerName(ownerId: string): string {
  return members.value.find((member) => member.id === ownerId)?.name || 'owner';
}
function participantStyle(message: SharedMessage): Record<string, string> {
  return hueStyle(
    message.agentId || message.participantId,
    message.role === 'assistant' ? 'agent' : 'human',
  );
}
function hueStyle(id: string, kind: 'agent' | 'human'): Record<string, string> {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const hue = kind === 'agent' ? hash % 22 : 210 + (hash % 28);
  return { '--participant-hue': String(hue) };
}
function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || '?'
  );
}
function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function basename(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).pop() || value;
}
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function string(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
function messageOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/^Error invoking remote method '[^']+': Error: /, '');
}
function showError(error: unknown): void {
  currentError.value = messageOf(error)
    .replace(/Sheep/g, 'Local catalog')
    .replace(/sheep/g, 'local catalog');
  showNotice(currentError.value);
}
function showNotice(value: string): void {
  if (noticeTimer) clearTimeout(noticeTimer);
  notice.value = value;
  noticeTimer = setTimeout(() => {
    notice.value = '';
  }, 4200);
}
</script>

<style scoped>
:global(html),
:global(body),
:global(#q-app) {
  height: 100%;
  margin: 0;
  min-width: 900px;
  min-height: 600px;
  overflow: hidden;
}
.app-shell {
  --bg: #f7f8fa;
  --panel: #fff;
  --panel-soft: #f1f4f8;
  --line: #dfe5ee;
  --text: #202838;
  --muted: #657086;
  --blue: #164bc4;
  --blue-soft: #e9f0ff;
  --red: #d43e49;
  --red-soft: #fff0f1;
  --green: #268966;
  --green-soft: #e9f7f1;
  background: var(--bg);
  color: var(--text);
  display: flex;
  flex-direction: column;
  height: 100%;
  font:
    14px/1.45 Inter,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    sans-serif;
  transition:
    background 0.2s,
    color 0.2s;
}
.app-shell[data-theme='green'] {
  --bg: #1b2521;
  --panel: #232f29;
  --panel-soft: #293830;
  --line: #40544a;
  --text: #e7f1e9;
  --muted: #a8b9ad;
  --blue: #86b7ff;
  --blue-soft: #2c3d4e;
  --red: #fa8786;
  --red-soft: #4b3030;
  --green: #67c794;
  --green-soft: #29483a;
}
button,
input,
textarea,
select {
  font: inherit;
}
button {
  color: inherit;
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.topbar {
  height: 58px;
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 0 20px;
  background: var(--panel);
  border-bottom: 1px solid var(--line);
  flex: none;
}
.brand-lockup {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 218px;
  color: var(--blue);
  font-weight: 700;
}
.brand-mark {
  font-weight: 850;
  font-size: 20px;
  letter-spacing: -2px;
}
.brand-name {
  font-size: 14px;
  letter-spacing: -0.2px;
}
.topbar-current {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  color: var(--muted);
  font-size: 13px;
}
.current-project {
  color: var(--text);
}
.topbar-separator {
  color: var(--line);
}
.topbar-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 13px;
}
.connection-state {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--muted);
  font-size: 12px;
}
.connection-state.online {
  color: var(--green);
}
.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #9aa3b1;
  display: inline-block;
  flex: none;
}
.status-dot.online {
  background: var(--green);
}
.connection-state.online .status-dot {
  background: var(--green);
}
.status-dot.busy {
  background: var(--red);
  animation: pulse 1.4s infinite;
}
.status-dot.queued {
  background: #d69743;
}
.icon-button,
.small-icon-button {
  display: inline-grid;
  place-items: center;
  border: 1px solid transparent;
  background: transparent;
  border-radius: 7px;
  color: var(--muted);
}
.icon-button {
  width: 34px;
  height: 34px;
}
.small-icon-button {
  width: 26px;
  height: 26px;
}
.icon-button:hover,
.small-icon-button:hover {
  background: var(--panel-soft);
  color: var(--text);
}
.workspace {
  display: grid;
  grid-template-columns: 250px minmax(440px, 1fr) 258px;
  min-height: 0;
  flex: 1;
}
.left-sidebar,
.right-sidebar {
  min-height: 0;
  background: var(--panel);
  display: flex;
  flex-direction: column;
}
.left-sidebar {
  border-right: 1px solid var(--line);
}
.right-sidebar {
  border-left: 1px solid var(--line);
}
.sidebar-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 14px 8px;
  color: var(--muted);
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}
.sidebar-section-head--spaced {
  margin-top: 10px;
}
.sidebar-scroll {
  overflow: auto;
  min-height: 0;
  flex: 1;
  padding: 0 8px;
}
.sidebar-row {
  width: 100%;
  min-height: 35px;
  display: flex;
  align-items: center;
  gap: 9px;
  border: 0;
  background: transparent;
  text-align: left;
  border-radius: 6px;
  padding: 7px 9px;
  color: var(--muted);
  font-size: 13px;
}
.sidebar-row > span:nth-child(2) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sidebar-row:hover {
  background: var(--panel-soft);
  color: var(--text);
}
.sidebar-row.selected {
  color: var(--blue);
  background: var(--blue-soft);
  font-weight: 600;
}
.sidebar-row.local-chat-row {
  min-height: 32px;
  padding-left: 36px;
}
.sidebar-note {
  margin: 6px 10px 8px;
  color: var(--muted);
  font-size: 11px;
}
.sidebar-bottom {
  border-top: 1px solid var(--line);
  padding: 8px;
}
.sidebar-version {
  display: block;
  padding: 4px 10px 8px;
  color: var(--muted);
  font-size: 10px;
}
.harness-mark {
  display: inline-grid;
  place-items: center;
  width: 18px;
  height: 18px;
  flex: none;
  border-radius: 5px;
  font-size: 10px;
  font-weight: 700;
  background: var(--panel-soft);
  color: var(--muted);
}
.harness-codex {
  color: var(--blue);
  background: var(--blue-soft);
}
.harness-hermes {
  color: var(--red);
  background: var(--red-soft);
}
.harness-pi,
.harness-claude,
.harness-opencode,
.harness-antigravity {
  color: var(--green);
  background: var(--green-soft);
}
.main-panel {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}
.room-heading,
.view-header {
  order: -2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 22px 28px 16px;
  border-bottom: 1px solid var(--line);
  background: var(--bg);
  flex: none;
}
.room-heading h1,
.view-header h1 {
  margin: 0;
  font-size: 21px;
  letter-spacing: -0.03em;
  font-weight: 650;
}
.eyebrow {
  margin: 0 0 4px;
  color: var(--muted);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.09em;
}
.subheading {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 12px;
  max-width: 600px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.room-actions {
  flex-shrink: 0;
  flex-wrap: wrap;
  display: flex;
  align-items: center;
  gap: 10px;
}
.room-heading > div:first-child,
.view-header > div:first-child { min-width: 0; flex: 1; }
.room-heading h1,
.view-header h1 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-action { min-height: 36px; padding: 8px 12px; font-size: 13px; white-space: nowrap; }
.native-status {
  margin: 8px 28px;
  flex: none;
}
.active-agent {
  color: var(--muted);
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 7px;
}
.message-viewport {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 20px 28px 12px;
  scroll-behavior: smooth;
}
.message-list,
.transcript-list {
  max-width: 860px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.chat-message {
  display: flex;
  gap: 11px;
  align-items: flex-start;
  --accent: hsl(var(--participant-hue) 68% 49%);
  --soft: hsl(var(--participant-hue) 75% 95%);
}
.app-shell[data-theme='green'] .chat-message {
  --soft: hsl(var(--participant-hue) 30% 24%);
}
.avatar {
  width: 29px;
  height: 29px;
  flex: none;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 10px;
  font-weight: 700;
  background: var(--soft);
  color: var(--accent);
}
.avatar-agent {
  border-radius: 8px;
}
.message-body {
  min-width: 0;
  flex: 1;
}
.message-meta {
  min-height: 25px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.message-meta strong {
  font-size: 12px;
  color: var(--text);
  font-weight: 650;
}
.message-meta time,
.transcript-message time {
  color: var(--muted);
  font-size: 10px;
  margin-left: auto;
}
.role-tag,
.harness-tag {
  font-size: 9px;
  line-height: 16px;
  padding: 0 6px;
  border-radius: 4px;
  text-transform: lowercase;
}
.human-tag {
  color: var(--blue);
  background: var(--blue-soft);
}
.agent-tag {
  color: var(--red);
  background: var(--red-soft);
}
.harness-tag {
  color: var(--muted);
  background: var(--panel-soft);
}
.pending-tag {
  font-size: 9px;
  color: var(--muted);
}
.message-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 13px;
  line-height: 1.55;
  color: var(--text);
  padding: 2px 0;
}
.message-error {
  color: var(--red);
  font-size: 12px;
}
.typing-indicator {
  height: 22px;
  display: flex;
  align-items: center;
  gap: 4px;
}
.typing-indicator span {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--red);
  animation: blink 1s infinite alternate;
}
.typing-indicator span:nth-child(2) {
  animation-delay: 0.2s;
}
.typing-indicator span:nth-child(3) {
  animation-delay: 0.4s;
}
.composer {
  position: relative;
  max-width: 860px;
  width: calc(100% - 56px);
  margin: 0 auto 20px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--panel);
  box-shadow: 0 2px 10px #1c2b4510;
  flex: none;
}
.composer:focus-within {
  border-color: var(--blue);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--blue) 14%, transparent);
}
.composer textarea {
  resize: none;
  width: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text);
  padding: 13px 14px 5px;
  min-height: 66px;
  max-height: 160px;
}
.composer textarea::placeholder {
  color: var(--muted);
}
.composer-footer {
  height: 35px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 8px 7px 14px;
  color: var(--muted);
  font-size: 10px;
}
.send-button {
  width: 29px;
  height: 27px;
  border: 0;
  border-radius: 6px;
  background: var(--blue);
  color: white;
  display: grid;
  place-items: center;
}
.mention-menu {
  position: absolute;
  left: 10px;
  bottom: calc(100% + 8px);
  width: min(390px, 95%);
  padding: 5px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: 0 8px 25px #15264424;
  z-index: 4;
}
.mention-menu button {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  background: transparent;
  padding: 8px;
  border-radius: 5px;
  text-align: left;
}
.mention-menu button:hover {
  background: var(--panel-soft);
}
.mention-menu strong {
  color: var(--red);
  font-size: 12px;
}
.mention-menu small {
  margin-left: auto;
  color: var(--muted);
  font-size: 10px;
}
.mention-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--red);
}
.right-section {
  padding: 16px 14px;
  border-bottom: 1px solid var(--line);
}
.right-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.right-heading h2 {
  font-size: 12px;
  margin: 0;
  font-weight: 650;
}
.right-heading > span {
  color: var(--muted);
  font-size: 10px;
}
.participant-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
}
.participant-avatar {
  --accent: hsl(var(--participant-hue, 215) 70% 50%);
  width: 23px;
  height: 23px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  flex: none;
  font-size: 9px;
  font-weight: 700;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 13%, transparent);
}
.agent-avatar {
  border-radius: 7px;
}
.participant-name {
  min-width: 0;
  flex: 1;
  font-size: 11px;
  font-weight: 550;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.participant-name small {
  display: block;
  color: var(--muted);
  font-size: 9px;
  font-weight: 400;
  overflow: hidden;
  text-overflow: ellipsis;
}
.you-label,
.agent-state {
  font-size: 9px;
  color: var(--muted);
}
.agent-state.working {
  color: var(--red);
}
.agent-state.queued {
  color: #d69743;
}
.room-rule p {
  margin: 0;
  color: var(--muted);
  font-size: 11px;
}
.room-rule code {
  color: var(--red);
  font-size: 10px;
}
.empty-state {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: var(--muted);
  gap: 10px;
  padding: 28px;
}
.empty-state h1,
.empty-state h2 {
  margin: 0;
  color: var(--text);
  font-size: 19px;
  font-weight: 650;
}
.empty-state p {
  max-width: 390px;
  margin: 0 0 6px;
  font-size: 12px;
}
.room-empty {
  opacity: 0.9;
}
.disconnected-state .large {
  font-size: 34px;
  color: var(--blue);
}
.primary-button,
.outline-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 34px;
  padding: 0 11px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
}
.primary-button {
  border: 1px solid var(--blue);
  background: var(--blue);
  color: white;
}
.primary-button:hover {
  filter: brightness(1.06);
}
.outline-button {
  border: 1px solid var(--line);
  background: var(--panel);
  color: var(--text);
}
.outline-button:hover {
  border-color: var(--blue);
  color: var(--blue);
}
.full-button {
  width: 100%;
  margin-top: 8px;
}
.back-link,
.text-button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 0;
  background: transparent;
  color: var(--blue);
  font-size: 11px;
  padding: 0;
  margin: 0 0 7px;
}
.text-button {
  margin: 0;
}
.text-button:hover,
.back-link:hover {
  text-decoration: underline;
}
.view-header {
  align-items: flex-end;
}
.native-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 20px 28px;
}
.transcript-message {
  max-width: 820px;
  padding: 11px 13px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
}
.transcript-message.user {
  border-left: 3px solid var(--blue);
}
.transcript-message.assistant {
  border-left: 3px solid var(--red);
}
.transcript-message pre {
  margin: 7px 0 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font:
    12px/1.6 ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
}
.message-meta .role-tag {
  font-weight: 650;
}
.source-records {
  max-width: 860px;
  margin: 30px auto;
}
.source-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.source-heading h2 {
  font-size: 14px;
  margin: 0;
}
.source-heading p {
  font-size: 10px;
  color: var(--muted);
  margin: 3px 0 0;
}
.source-record {
  border: 1px solid var(--line);
  background: var(--panel);
  border-radius: 6px;
  margin: 5px 0;
}
.source-record summary {
  list-style: none;
  padding: 8px 10px;
  display: flex;
  gap: 12px;
  align-items: center;
  cursor: pointer;
  font-size: 11px;
}
.source-record summary::-webkit-details-marker {
  display: none;
}
.source-record summary span:first-child {
  font-weight: 650;
}
.source-record summary span:nth-child(2),
.source-record summary time {
  color: var(--muted);
  font-size: 10px;
}
.source-record summary time {
  margin-left: auto;
}
.source-record pre {
  overflow: auto;
  max-height: 420px;
  margin: 0;
  border-top: 1px solid var(--line);
  padding: 12px;
  color: var(--text);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font:
    10px/1.5 ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
}
.settings-backdrop,
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: #14203a66;
  z-index: 10;
  display: flex;
  justify-content: flex-end;
}
.settings-panel {
  width: min(460px, 95vw);
  height: 100%;
  background: var(--panel);
  border-left: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  box-shadow: -10px 0 35px #15274422;
}
.settings-header {
  padding: 18px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--line);
  flex: none;
}
.settings-header h2 {
  font-size: 20px;
  margin: 0;
  font-weight: 650;
}
.settings-scroll {
  overflow: auto;
  min-height: 0;
  flex: 1;
  padding: 0 20px;
}
.settings-section {
  padding: 18px 0;
  border-bottom: 1px solid var(--line);
}
.settings-section h3 {
  font-size: 13px;
  margin: 0 0 12px;
}
.settings-section label {
  display: block;
  font-size: 10px;
  color: var(--muted);
  margin: 10px 0;
}
.settings-section input,
.settings-section select {
  display: block;
  width: 100%;
  height: 34px;
  margin-top: 5px;
  padding: 0 9px;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 5px;
  outline: 0;
  font-size: 11px;
}
.settings-section input:focus,
.settings-section select:focus {
  border-color: var(--blue);
}
.connection-forms {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 9px;
  margin-top: 12px;
}
.connection-card {
  border: 1px solid var(--line);
  border-radius: 7px;
  padding: 10px;
}
.connection-card > strong {
  font-size: 11px;
}
.connection-card label {
  margin: 9px 0 5px;
}
.connected-account {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px;
  background: var(--panel-soft);
  border-radius: 6px;
  font-size: 11px;
}
.connected-account > span:nth-child(2) {
  flex: 1;
}
.connected-account small,
.harness-status-row small {
  display: block;
  color: var(--muted);
  font-size: 9px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.invite-tools {
  margin-top: 12px;
}
.invite-codes {
  display: grid;
  gap: 5px;
  margin-top: 7px;
}
.invite-codes code {
  overflow-wrap: anywhere;
  padding: 6px;
  background: var(--panel-soft);
  border-radius: 4px;
  color: var(--text);
  font-size: 10px;
}
.theme-options {
  display: flex;
  gap: 6px;
}
.theme-options button {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--line);
  background: var(--bg);
  border-radius: 5px;
  min-height: 34px;
  color: var(--muted);
  font-size: 10px;
}
.theme-options button.active {
  border-color: var(--blue);
  color: var(--blue);
  background: var(--blue-soft);
}
.section-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.section-title-row h3 {
  margin: 0;
}
.section-help {
  font-size: 10px;
  color: var(--muted);
  margin: 6px 0 10px;
}
.agent-picker {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.agent-picker button {
  padding: 5px 8px;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: var(--bg);
  font-size: 10px;
  color: var(--muted);
}
.agent-picker button.active {
  color: var(--red);
  border-color: var(--red);
  background: var(--red-soft);
}
.folder-field {
  display: flex;
  align-items: flex-end;
  gap: 7px;
}
.folder-field label {
  flex: 1;
}
.folder-field button {
  margin-bottom: 10px;
}
.toggle-row {
  display: flex !important;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 15px 0 5px !important;
}
.toggle-row strong,
.toggle-row small {
  display: block;
}
.toggle-row strong {
  color: var(--text);
  font-size: 11px;
}
.toggle-row small {
  font-size: 9px;
  margin-top: 3px;
}
.toggle-row input {
  width: 32px !important;
  height: 17px !important;
  accent-color: var(--blue);
  margin: 0 !important;
  flex: none;
}
.harness-status-row {
  min-height: 40px;
  display: flex;
  align-items: center;
  gap: 8px;
  border-top: 1px solid var(--line);
}
.harness-status-row > span:nth-child(2) {
  font-size: 11px;
  flex: 1;
}
.harness-status-row .text-button {
  font-size: 10px;
}
.settings-footer {
  height: 58px;
  flex: none;
  border-top: 1px solid var(--line);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
}
.settings-footer > span {
  color: var(--green);
  font-size: 10px;
}
.error-text {
  color: var(--red);
  font-size: 10px;
  overflow-wrap: anywhere;
}
.modal-backdrop {
  align-items: center;
  justify-content: center;
}
.permission-modal {
  width: min(520px, 90vw);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 9px;
  box-shadow: 0 16px 50px #09152c55;
}
.permission-modal pre {
  max-height: 280px;
  overflow: auto;
  margin: 16px 20px;
  padding: 12px;
  background: var(--panel-soft);
  border-radius: 6px;
  white-space: pre-wrap;
  font:
    11px/1.5 ui-monospace,
    Menlo,
    monospace;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px 20px 20px;
}
.toast {
  position: fixed;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 30;
  padding: 9px 13px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--panel);
  color: var(--text);
  font-size: 11px;
  box-shadow: 0 5px 20px #08132a22;
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes blink {
  to {
    opacity: 0.25;
  }
}
@keyframes pulse {
  50% {
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--red) 17%, transparent);
  }
}
@media (max-width: 1120px) {
  .workspace {
    grid-template-columns: 220px minmax(420px, 1fr);
  }
  .right-sidebar {
    display: none;
  }
  .brand-lockup {
    min-width: 190px;
  }
}
@media (max-width: 760px) {
  :global(html),
  :global(body),
  :global(#q-app) {
    min-width: 600px;
  }
  .workspace {
    grid-template-columns: 185px minmax(400px, 1fr);
  }
  .topbar {
    padding: 0 12px;
    gap: 10px;
  }
  .brand-lockup {
    min-width: 155px;
  }
  .room-heading,
  .view-header {
    padding: 17px;
  }
  .message-viewport,
  .native-content {
    padding-left: 17px;
    padding-right: 17px;
  }
  .composer {
    width: calc(100% - 34px);
  }
}

/* The original application appearance remains available as Classic. */
.app-shell[data-theme='classic'] {
  --bg: #f7f8fa;
  --panel: #fff;
  --panel-soft: #f1f4f8;
  --line: #dfe5ee;
  --text: #202838;
  --muted: #657086;
  --blue: #164bc4;
  --blue-soft: #e9f0ff;
  --red: #d43e49;
  --red-soft: #fff0f1;
  --green: #268966;
  --green-soft: #e9f7f1;
}
.app-shell[data-theme='cobalt-red'] {
  --bg: #fcfcf9;
  --panel: #fff;
  --panel-soft: #f7f8ff;
  --line: #1748c8;
  --text: #123ca9;
  --muted: #4762a8;
  --blue: #2148b8;
  --blue-soft: #e8efff;
  --red: #c83232;
  --red-soft: #fce8e7;
  --green: #367e62;
  --green-soft: #e9f5ee;
  font-family: 'DM Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  letter-spacing: -0.02em;
}
.app-shell[data-theme='mint-charcoal'] {
  --bg: #fbfbf8;
  --panel: #fff;
  --panel-soft: #eef4f0;
  --line: #c9cecb;
  --text: #272829;
  --muted: #6d7471;
  --blue: #245ca5;
  --blue-soft: #e5f0fa;
  --red: #b94343;
  --red-soft: #f8e9e9;
  --green: #5eb783;
  --green-soft: #e4f5ea;
  font-family: Archivo, Arial, sans-serif;
  font-size: 14px;
}
.app-shell :global(button:focus-visible),
.app-shell :global(input:focus-visible),
.app-shell :global(select:focus-visible),
.app-shell :global(textarea:focus-visible) {
  outline: 2px solid var(--blue);
  outline-offset: 2px;
}
.topbar {
  height: 51px;
  gap: 16px;
  padding: 0 18px;
}
.brand-lockup {
  border: 0;
  background: transparent;
  padding: 0;
  min-width: 0;
  font: inherit;
  text-align: left;
  white-space: nowrap;
}
.brand-mark {
  font-family: Archivo, Arial, sans-serif;
  font-size: 25px;
  font-weight: 900;
  letter-spacing: -0.12em;
  line-height: 1;
  display: none;
}
.brand-art {
  display: block;
  width: 39px;
  aspect-ratio: 1479 / 1064;
  flex: none;
  background-image: url('../assets/brand/mint-charcoal-logo.png');
  background-size: 100% 100%;
}
.brand-name {
  font-family: Archivo, Arial, sans-serif;
  font-size: 15px;
  font-weight: 800;
  letter-spacing: -0.035em;
}
.topbar-current {
  font-size: 12px;
}
.workspace {
  grid-template-columns: 278px minmax(0, 1fr) 286px;
}
.app-shell.left-collapsed .workspace {
  grid-template-columns: minmax(0, 1fr) 286px;
}
.app-shell.right-collapsed .workspace {
  grid-template-columns: 278px minmax(0, 1fr);
}
.app-shell.left-collapsed.right-collapsed .workspace {
  grid-template-columns: minmax(0, 1fr);
}
.left-sidebar {
  position: relative;
}
.sidebar-scroll {
  padding: 0 10px;
}
.sidebar-search {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px 12px 5px;
  padding: 0 9px;
  height: 36px;
  border: 1px solid var(--line);
  border-radius: 4px;
  color: var(--muted);
  background: var(--panel);
}
.sidebar-search input {
  min-width: 0;
  width: 100%;
  height: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text);
  font-size: 12px;
}
.sidebar-search input::placeholder {
  color: var(--muted);
}
.sidebar-filters {
  display: flex;
  gap: 5px;
  margin: 0 12px 10px;
}
.sidebar-filters select {
  width: 50%;
  height: 28px;
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: 3px;
  background: var(--panel);
  color: var(--muted);
  font-size: 10px;
  padding: 0 4px;
}
.sidebar-section-head {
  padding: 13px 12px 6px;
}
.sidebar-section-head--spaced {
  margin-top: 8px;
}
.sidebar-bottom {
  margin-top: auto;
}
.settings-nav {
  font-weight: 600;
}
.sidebar-section-toggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-transform: inherit;
  letter-spacing: inherit;
  padding: 0;
  text-align: left;
}
.sidebar-section-toggle span {
  opacity: 0.7;
  font-size: 10px;
  margin-left: 3px;
}
.more-row {
  color: var(--blue);
  font-size: 11px;
  justify-content: center;
}
.right-sidebar {
  overflow: auto;
}
.right-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0 16px;
  padding: 20px 0 12px;
  border-bottom: 1px solid var(--line);
}
.right-panel-header h2 {
  font-size: 19px;
  line-height: 1.1;
  margin: 0;
}
.right-section {
  margin: 0 16px;
  padding: 17px 0;
}
.right-heading h2 {
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-size: 11px;
}
.participant-row {
  min-height: 42px;
}
.participant-name {
  font-size: 12px;
}
.participant-name small {
  font-size: 10px;
}
.participant-avatar {
  width: 28px;
  height: 28px;
}
.room-heading,
.view-header {
  padding: 18px 24px 13px;
}
.room-heading h1,
.view-header h1 {
  font-size: 28px;
  font-weight: 750;
}
.message-viewport {
  padding: 20px 24px 12px;
}
.message-list {
  gap: 21px;
  max-width: none;
}
.message-meta strong {
  font-size: 13px;
}
.message-text {
  font-size: 14px;
}
.avatar {
  width: 35px;
  height: 35px;
}
.composer {
  max-width: none;
  width: calc(100% - 48px);
  margin-bottom: 15px;
}
.composer textarea {
  min-height: 56px;
}
.composer-footer {
  height: 32px;
}
.settings-page {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  background: var(--bg);
}
.settings-page .settings-header {
  padding: 24px 30px 14px;
  background: var(--bg);
}
.settings-page .settings-header h1 {
  font-size: 28px;
  margin: 0;
  line-height: 1.15;
}
.settings-page .settings-scroll {
  padding: 0 30px;
  overflow: auto;
}
.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 34px;
  max-width: 1080px;
}
.settings-page .settings-section {
  padding: 22px 0;
}
.settings-page .settings-section h3 {
  font-size: 16px;
}
.settings-page .settings-section label {
  font-size: 12px;
}
.settings-page .settings-section input,
.settings-page .settings-section select {
  height: 38px;
  font-size: 12px;
}
.settings-page .section-help {
  font-size: 12px;
}
.settings-page .settings-footer {
  padding: 0 30px;
  background: var(--bg);
}
.theme-options {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 9px;
}
.theme-options .theme-option {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 7px;
  padding: 6px;
  background: var(--panel);
  font-size: 11px;
  text-align: left;
  border-radius: 4px;
  color: var(--text);
}
.theme-option.active {
  outline: 2px solid var(--blue);
  outline-offset: 1px;
}
.theme-swatch {
  height: 59px;
  display: flex;
  align-items: flex-start;
  padding: 6px 8px;
  font:
    900 25px/1 Archivo,
    Arial,
    sans-serif;
  letter-spacing: -0.12em;
}
.theme-option-cobalt-red .theme-swatch {
  background: linear-gradient(90deg, #c83232 33%, #fff 33%);
  color: #fff;
}
.theme-option-mint-charcoal .theme-swatch {
  background: linear-gradient(90deg, #5eb783 33%, #fff 33%);
  color: #302d2e;
}
.theme-option-classic .theme-swatch {
  background: linear-gradient(90deg, #edf1f7 33%, #fff 33%);
  color: #164bc4;
}
.app-shell[data-theme='cobalt-red'] .topbar {
  border-bottom: 2px solid var(--blue);
  color: var(--blue);
  background: #fff;
}
.app-shell[data-theme='cobalt-red'] .brand-lockup {
  color: var(--blue);
}
.app-shell[data-theme='cobalt-red'] .brand-mark,
.app-shell[data-theme='mint-charcoal'] .brand-mark {
  display: none;
}
.app-shell[data-theme='cobalt-red'] .brand-art,
.app-shell[data-theme='mint-charcoal'] .brand-art {
  display: block;
}
.app-shell[data-theme='cobalt-red'] .brand-art {
  background-image: url('../assets/brand/mint-charcoal-logo.png');
}
.app-shell[data-theme='mint-charcoal'] .brand-art {
  background-image: url('../assets/brand/mint-charcoal-logo.png');
}
.app-shell[data-theme='cobalt-red'] .left-sidebar {
  border-right: 2px solid var(--blue);
}
.app-shell[data-theme='cobalt-red'] .left-sidebar::before {
  content: '';
  display: block;
  width: 100%;
  aspect-ratio: 1479 / 1064;
  flex: none;
  background: url('../assets/brand/cobalt-red-logo.png') center / 100% 100% no-repeat;
}
.app-shell[data-theme='cobalt-red'] .right-sidebar {
  border-left: 2px solid var(--blue);
}
.app-shell[data-theme='cobalt-red'] .right-panel-header {
  border-bottom: 1px solid var(--blue);
}
.app-shell[data-theme='cobalt-red'] .right-panel-header h2 {
  color: var(--blue);
  font-family: Archivo, Arial, sans-serif;
  font-weight: 800;
  font-size: 19px;
}
.app-shell[data-theme='cobalt-red'] .right-section {
  border-bottom: 1px solid var(--blue);
}
.app-shell[data-theme='cobalt-red'] .sidebar-section-head,
.app-shell[data-theme='cobalt-red'] .right-heading h2 {
  color: var(--blue);
}
.app-shell[data-theme='cobalt-red'] .sidebar-row {
  border-radius: 0;
  color: var(--blue);
  font-size: 13px;
}
.app-shell[data-theme='cobalt-red'] .sidebar-row.selected {
  background: #2148b8;
  color: #fff;
}
.app-shell[data-theme='cobalt-red'] .sidebar-row.selected .harness-mark {
  background: #fff;
  color: var(--blue);
}
.app-shell[data-theme='cobalt-red'] .sidebar-row:hover:not(.selected) {
  background: #eef2ff;
}
.app-shell[data-theme='cobalt-red'] .main-panel {
  background: #fff;
}
.app-shell[data-theme='cobalt-red'] .room-heading {
  background: #fff;
  border-bottom: 1px solid var(--blue);
}
.app-shell[data-theme='cobalt-red'] .room-heading h1 {
  font:
    800 37px/1 Archivo,
    Arial,
    sans-serif;
  color: var(--blue);
}
.app-shell[data-theme='cobalt-red'] .message-text {
  color: var(--blue);
  font:
    15px/1.5 'DM Mono',
    Menlo,
    monospace;
}
.app-shell[data-theme='cobalt-red'] .message-meta strong {
  color: var(--blue);
  font-family: Archivo, Arial, sans-serif;
  font-size: 15px;
}
.app-shell[data-theme='cobalt-red'] .avatar,
.app-shell[data-theme='cobalt-red'] .participant-avatar {
  background: #fff;
  border: 1.5px solid currentColor;
  border-radius: 50%;
  color: var(--accent);
}
.app-shell[data-theme='cobalt-red'] .role-tag {
  border-radius: 2px;
}
.app-shell[data-theme='cobalt-red'] .agent-tag {
  background: var(--red);
  color: #fff;
}
.app-shell[data-theme='cobalt-red'] .human-tag {
  background: var(--blue);
  color: #fff;
}
.app-shell[data-theme='cobalt-red'] .composer {
  border: 1.5px solid var(--blue);
  border-radius: 7px;
  box-shadow: none;
}
.app-shell[data-theme='cobalt-red'] .send-button {
  border-radius: 3px;
  width: 60px;
  height: 29px;
}
.app-shell[data-theme='cobalt-red'] .settings-page {
  background: #fff;
}
.app-shell[data-theme='mint-charcoal'] .topbar {
  background: #5eb783;
  border-color: #5eb783;
  color: #302d2e;
}
.app-shell[data-theme='mint-charcoal'] .topbar .brand-lockup {
  color: #302d2e;
}
.app-shell[data-theme='mint-charcoal'] .left-sidebar {
  background: #5eb783;
  border-right: 1px solid #acd8bd;
  color: #302d2e;
}
.app-shell[data-theme='mint-charcoal'] .left-sidebar::before {
  content: '';
  display: block;
  width: 100%;
  aspect-ratio: 1478 / 1064;
  flex: none;
  background: url('../assets/brand/mint-charcoal-logo.png') center / 100% 100% no-repeat;
}
.app-shell[data-theme='mint-charcoal'] .sidebar-search,
.app-shell[data-theme='mint-charcoal'] .sidebar-filters select {
  background: #76c997;
  border-color: #3c8c5d;
  color: #26382c;
}
.app-shell[data-theme='mint-charcoal'] .sidebar-search input::placeholder {
  color: #3d7752;
}
.app-shell[data-theme='mint-charcoal'] .sidebar-section-head,
.app-shell[data-theme='mint-charcoal'] .sidebar-row,
.app-shell[data-theme='mint-charcoal'] .sidebar-note {
  color: #26382c;
}
.app-shell[data-theme='mint-charcoal'] .sidebar-row {
  border-radius: 3px;
}
.app-shell[data-theme='mint-charcoal'] .sidebar-row.selected {
  background: #302d2e;
  color: #85d5a6;
}
.app-shell[data-theme='mint-charcoal'] .sidebar-row:hover:not(.selected) {
  background: #8ad7a8;
}
.app-shell[data-theme='mint-charcoal'] .sidebar-bottom {
  border-top-color: #3c8c5d;
}
.app-shell[data-theme='mint-charcoal'] .right-sidebar {
  border-left: 1px solid #c9cecb;
}
.app-shell[data-theme='mint-charcoal'] .right-panel-header h2 {
  font-size: 18px;
}
.app-shell[data-theme='mint-charcoal'] .main-panel {
  background: #fff;
}
.app-shell[data-theme='mint-charcoal'] .room-heading {
  background: #fff;
}
.app-shell[data-theme='mint-charcoal'] .room-heading h1 {
  font:
    800 32px/1 Archivo,
    Arial,
    sans-serif;
}
.app-shell[data-theme='mint-charcoal'] .avatar,
.app-shell[data-theme='mint-charcoal'] .participant-avatar {
  background: #d9f2e2;
  border-radius: 50%;
  color: var(--accent);
}
.app-shell[data-theme='mint-charcoal'] .chat-message.assistant .message-meta strong {
  color: #399963;
}
.app-shell[data-theme='mint-charcoal'] .message-text {
  color: #292b2a;
  font-size: 15px;
}
.app-shell[data-theme='mint-charcoal'] .composer {
  border-radius: 4px;
  box-shadow: none;
}
.app-shell[data-theme='mint-charcoal'] .send-button {
  background: #5eb783;
  border-radius: 3px;
  color: #fff;
  width: 56px;
}
.app-shell[data-theme='mint-charcoal'] .settings-page {
  background: #fff;
}
@media (max-width: 1120px) {
  .workspace {
    grid-template-columns: 230px minmax(0, 1fr) 240px;
  }
  .right-sidebar {
    display: flex;
  }
  .app-shell.left-collapsed .workspace {
    grid-template-columns: minmax(0, 1fr) 240px;
  }
  .app-shell.right-collapsed .workspace {
    grid-template-columns: 230px minmax(0, 1fr);
  }
  .app-shell.left-collapsed.right-collapsed .workspace {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 900px) {
  :global(html),
  :global(body),
  :global(#q-app) {
    min-width: 720px;
  }
  .workspace {
    grid-template-columns: 205px minmax(0, 1fr) 210px;
  }
  .app-shell.left-collapsed .workspace {
    grid-template-columns: minmax(0, 1fr) 210px;
  }
  .app-shell.right-collapsed .workspace {
    grid-template-columns: 205px minmax(0, 1fr);
  }
  .settings-grid {
    grid-template-columns: 1fr;
  }
  .topbar-current {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .app-shell,
  .typing-indicator span,
  .status-dot.busy {
    transition: none;
    animation: none;
  }
}
.theme-options .theme-option.active {
  background: var(--panel);
  color: var(--text);
}
.project-row { position: relative; }
.sidebar-tools { display: flex; align-items: center; gap: 2px; }
.project-button { padding-right: 34px; }
.project-button > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.project-button > svg { flex-shrink: 0; }
.project-new-chat { position: absolute; right: 5px; top: 50%; transform: translateY(-50%); opacity: 0; }
.project-row:hover .project-new-chat, .project-row:focus-within .project-new-chat { opacity: 1; }
.composer-controls { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; margin-right: 12px; }
.composer-controls select { height: 26px; min-width: 0; border: 1px solid var(--line); border-radius: 4px; color: var(--text); background: var(--panel); padding: 2px 7px; font: inherit; font-size: 12px; }
.composer-controls select:first-child { flex: 1; width: 0; max-width: 240px; }
.composer-controls > span { white-space: nowrap; }
.send-button { flex-shrink: 0; }
/* Shared dialog contents use the same spacing and type in every theme. */
.invite-content, .join-form { display: grid; gap: 16px; font-size: 14px; line-height: 1.5; }
.invite-content p, .join-form p { margin: 0; }
.dialog-context { display: flex; align-items: center; gap: 8px; color: var(--muted); }
.invite-content label, .join-form label { display: grid; gap: 8px; font-size: 13px; font-weight: 400; }
.invite-content input, .join-form input {
  box-sizing: border-box; min-width: 0; width: 100%; padding: 10px 12px;
  border: 1px solid var(--line); border-radius: 4px; background: var(--panel); color: var(--text);
  font: 400 14px/20px Arial, sans-serif;
}
.invite-code-row { display: flex; align-items: stretch; gap: 8px; }
.invite-code-row input { flex: 1; font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
.invite-content .primary-button, .invite-content .outline-button, .join-form .primary-button, .join-form .outline-button { flex: none; font: 400 13px/1.5 Arial, sans-serif; }
.dialog-actions { display: flex; justify-content: flex-end; gap: 8px; }
.dialog-error { color: var(--red); font-size: 13px; overflow-wrap: anywhere; }
.invite-retry { justify-self: start; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
@media (hover: none) { .project-new-chat { opacity: 1; } }
.harness-account-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.harness-account-actions button, .settings-footer > span { display: inline-flex; align-items: center; gap: 6px; }
.codex-account-row { flex-wrap: wrap; padding: 8px 0; }
.harness-account-feedback { font-size: 12px; line-height: 1.5; margin: 8px 0 12px; color: var(--text); }
.settings-footer > span { font-size: 12px; }
.settings-footer > .error-text { color: var(--red); }
.settings-save-warning { order: -1; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex: none; padding: 12px 24px; border-bottom: 1px solid var(--line); color: var(--red); font-size: 13px; }
</style>
