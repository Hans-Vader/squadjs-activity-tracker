import BasePlugin from './base-plugin.js';

export default class ActivityTracker extends BasePlugin {
  static get description() {
    return (
      'Tracks player activity to help moderators identify AFK players. ' +
      'Provides <code>!afk</code> commands to list inactive players based on ' +
      'kills, deaths, damage, revives, squad changes, and other events. ' +
      'Reporting only — no automatic kicks.'
    );
  }

  static get defaultEnabled() {
    return false;
  }

  static get optionsSpecification() {
    return {
      defaultInactiveMinutes: {
        required: false,
        description: 'Default inactivity threshold in minutes when running !afk with no argument.',
        default: 10
      },
      ignoreChatForActivity: {
        required: false,
        description: 'If true, chat messages will NOT count as player activity.',
        default: false
      },
      adminChatOnly: {
        required: false,
        description:
          'If true, the !afk command only works when typed in admin chat (ChatAdmin).',
        default: true
      },
      commandPrefix: {
        required: false,
        description: 'The chat command trigger word (without the ! prefix).',
        default: 'afk'
      },
      warnMessageHeader: {
        required: false,
        description: 'Header text shown at the top of AFK report messages.',
        default: '--- AFK Report ---'
      },
      maxPage: {
        required: false,
        description:
          'Maximum number of warn pages (messages) to send per command response.',
        default: 2
      }
    };
  }

  constructor(server, options, connectors) {
    super(server, options, connectors);

    this.activityData = new Map();

    this.onPlayerWounded = this.onPlayerWounded.bind(this);
    this.onPlayerDied = this.onPlayerDied.bind(this);
    this.onPlayerRevived = this.onPlayerRevived.bind(this);
    this.onPlayerSquadChange = this.onPlayerSquadChange.bind(this);
    this.onChatMessage = this.onChatMessage.bind(this);
    this.onPlayerConnected = this.onPlayerConnected.bind(this);
    this.onPlayerDisconnected = this.onPlayerDisconnected.bind(this);
    this.onNewGame = this.onNewGame.bind(this);
    this.onSquadCreated = this.onSquadCreated.bind(this);
    this.onPlayerTeamChange = this.onPlayerTeamChange.bind(this);
    this.onTeamkill = this.onTeamkill.bind(this);
    this.onPlayerDamaged = this.onPlayerDamaged.bind(this);
    this.onDeployableDamaged = this.onDeployableDamaged.bind(this);
    this.onAfkCommand = this.onAfkCommand.bind(this);
  }

  async mount() {
    this.server.on('PLAYER_WOUNDED', this.onPlayerWounded);
    this.server.on('PLAYER_DIED', this.onPlayerDied);
    this.server.on('PLAYER_REVIVED', this.onPlayerRevived);
    this.server.on('PLAYER_SQUAD_CHANGE', this.onPlayerSquadChange);
    this.server.on('CHAT_MESSAGE', this.onChatMessage);
    this.server.on('PLAYER_CONNECTED', this.onPlayerConnected);
    this.server.on('PLAYER_DISCONNECTED', this.onPlayerDisconnected);
    this.server.on('NEW_GAME', this.onNewGame);
    this.server.on('SQUAD_CREATED', this.onSquadCreated);
    this.server.on('PLAYER_TEAM_CHANGE', this.onPlayerTeamChange);
    this.server.on('TEAMKILL', this.onTeamkill);
    this.server.on('PLAYER_DAMAGED', this.onPlayerDamaged);
    this.server.on('DEPLOYABLE_DAMAGED', this.onDeployableDamaged);
    this.server.on(`CHAT_COMMAND:${this.options.commandPrefix}`, this.onAfkCommand);

    // Pre-seed activity for all currently connected players.
    for (const player of this.server.players) {
      if (player.eosID) {
        this.recordActivity(player.eosID, player.name, 'Mount');
      }
    }

    this.verbose(1, 'Activity tracker mounted and listening for events.');
  }

  async unmount() {
    this.server.removeEventListener('PLAYER_WOUNDED', this.onPlayerWounded);
    this.server.removeEventListener('PLAYER_DIED', this.onPlayerDied);
    this.server.removeEventListener('PLAYER_REVIVED', this.onPlayerRevived);
    this.server.removeEventListener('PLAYER_SQUAD_CHANGE', this.onPlayerSquadChange);
    this.server.removeEventListener('CHAT_MESSAGE', this.onChatMessage);
    this.server.removeEventListener('PLAYER_CONNECTED', this.onPlayerConnected);
    this.server.removeEventListener('PLAYER_DISCONNECTED', this.onPlayerDisconnected);
    this.server.removeEventListener('NEW_GAME', this.onNewGame);
    this.server.removeEventListener('SQUAD_CREATED', this.onSquadCreated);
    this.server.removeEventListener('PLAYER_TEAM_CHANGE', this.onPlayerTeamChange);
    this.server.removeEventListener('TEAMKILL', this.onTeamkill);
    this.server.removeEventListener('PLAYER_DAMAGED', this.onPlayerDamaged);
    this.server.removeEventListener('DEPLOYABLE_DAMAGED', this.onDeployableDamaged);
    this.server.removeEventListener(
      `CHAT_COMMAND:${this.options.commandPrefix}`,
      this.onAfkCommand
    );

    this.activityData.clear();
  }

  // --- Activity Recording ---

  recordActivity(eosID, playerName, eventType) {
    this.activityData.set(eosID, {
      lastActivity: new Date(),
      lastEventType: eventType,
      playerName: playerName
    });
    this.verbose(3, `Activity: ${playerName} -> ${eventType}`);
  }

  // --- Event Handlers ---

  onPlayerWounded(data) {
    if (data.attacker && data.attacker.eosID) {
      this.recordActivity(data.attacker.eosID, data.attacker.name, 'Wound');
    }
    if (data.victim && data.victim.eosID) {
      this.recordActivity(data.victim.eosID, data.victim.name, 'Wounded');
    }
  }

  onPlayerDied(data) {
    if (data.victim && data.victim.eosID) {
      this.recordActivity(data.victim.eosID, data.victim.name, 'Death');
    }
    if (data.attacker && data.attacker.eosID) {
      this.recordActivity(data.attacker.eosID, data.attacker.name, 'Kill');
    }
  }

  onPlayerRevived(data) {
    if (data.reviver && data.reviver.eosID) {
      this.recordActivity(data.reviver.eosID, data.reviver.name, 'Revive');
    }
    if (data.victim && data.victim.eosID) {
      this.recordActivity(data.victim.eosID, data.victim.name, 'Revived');
    }
  }

  onPlayerSquadChange(data) {
    if (data.player && data.player.eosID) {
      this.recordActivity(data.player.eosID, data.player.name, 'SquadChange');
    }
  }

  onChatMessage(data) {
    if (this.options.ignoreChatForActivity) return;
    if (data.player && data.player.eosID) {
      this.recordActivity(data.player.eosID, data.player.name, 'Chat');
    }
  }

  onPlayerConnected(data) {
    if (data.player && data.player.eosID) {
      this.recordActivity(data.player.eosID, data.player.name, 'Connected');
    }
  }

  onPlayerDisconnected(data) {
    if (data.player && data.player.eosID) {
      this.activityData.delete(data.player.eosID);
      this.verbose(2, `Removed activity data for disconnected player: ${data.player.name}`);
    }
  }

  onNewGame() {
    this.activityData.clear();
    this.verbose(1, 'New game — activity data cleared.');

    // Re-seed from currently connected players.
    for (const player of this.server.players) {
      if (player.eosID) {
        this.recordActivity(player.eosID, player.name, 'NewGame');
      }
    }
  }

  onSquadCreated(data) {
    if (data.player && data.player.eosID) {
      this.recordActivity(data.player.eosID, data.player.name, 'SquadCreated');
    }
  }

  onPlayerTeamChange(data) {
    if (data.player && data.player.eosID) {
      this.recordActivity(data.player.eosID, data.player.name, 'TeamChange');
    }
  }

  onTeamkill(data) {
    if (data.attacker && data.attacker.eosID) {
      this.recordActivity(data.attacker.eosID, data.attacker.name, 'Teamkill');
    }
    if (data.victim && data.victim.eosID) {
      this.recordActivity(data.victim.eosID, data.victim.name, 'Teamkilled');
    }
  }

  onPlayerDamaged(data) {
    if (data.attacker && data.attacker.eosID) {
      this.recordActivity(data.attacker.eosID, data.attacker.name, 'Damage');
    }
    if (data.victim && data.victim.eosID) {
      this.recordActivity(data.victim.eosID, data.victim.name, 'Damaged');
    }
  }

  onDeployableDamaged(data) {
    if (data.attacker && data.attacker.eosID) {
      this.recordActivity(data.attacker.eosID, data.attacker.name, 'DeployableDmg');
    }
  }

  // --- Command Handler ---

  async onAfkCommand(data) {
    if (this.options.adminChatOnly && data.chat !== 'ChatAdmin') return;

    const caller = data.player;
    if (!caller || !caller.eosID) return;

    const args = (data.message || '').trim();

    // !afk (no args) — list inactive > default threshold
    if (args === '') {
      return this.listInactivePlayers(caller, this.options.defaultInactiveMinutes);
    }

    // !afk <number> — list inactive > N minutes
    if (/^\d+$/.test(args)) {
      return this.listInactivePlayers(caller, parseInt(args, 10));
    }

    // !afk sq <N> or !afk other sq <N>
    const squadMatch = args.match(/^(?:(other)\s+)?sq\s+(\d+)$/i);
    if (squadMatch) {
      const isOtherTeam = !!squadMatch[1];
      const squadNum = parseInt(squadMatch[2], 10);
      const targetTeamID = isOtherTeam
        ? this.getOpposingTeam(caller.teamID)
        : caller.teamID;
      return this.listSquadActivity(caller, targetTeamID, squadNum);
    }

    // !afk <playerName> — lookup specific player
    return this.lookupPlayer(caller, args);
  }

  // --- Output Methods ---

  async listInactivePlayers(caller, minutesThreshold) {
    const now = new Date();
    const thresholdMs = minutesThreshold * 60 * 1000;
    const inactive = [];

    for (const player of this.server.players) {
      if (!player.eosID || player.squadID == null) continue;

      const record = this.activityData.get(player.eosID);
      const inactiveMs = record ? now - record.lastActivity : Infinity;

      if (inactiveMs >= thresholdMs) {
        inactive.push({
          name: player.name,
          teamID: player.teamID,
          squadID: player.squadID,
          inactiveMs,
          lastEvent: record ? record.lastEventType : 'Unknown'
        });
      }
    }

    if (inactive.length === 0) {
      await this.server.rcon.warn(
        caller.eosID,
        `No inactive players found (>${minutesThreshold}m).`
      );
      return;
    }

    inactive.sort((a, b) => b.inactiveMs - a.inactiveMs);

    const lines = [`${this.options.warnMessageHeader} (>${minutesThreshold}m)`];
    for (const entry of inactive) {
      lines.push(
        `[${this.formatDuration(entry.inactiveMs)}] T:${entry.teamID}/S:${entry.squadID} ${entry.name} (last: ${entry.lastEvent})`
      );
    }
    lines.push('---');
    lines.push(`${inactive.length} player(s) inactive >${minutesThreshold}m`);

    await this.sendWarns(caller.eosID, lines.join('\n'));
  }

  async listSquadActivity(caller, teamID, squadID) {
    const now = new Date();
    const members = [];

    for (const player of this.server.players) {
      if (!player.eosID) continue;
      if (player.teamID !== teamID || player.squadID !== squadID) continue;

      const record = this.activityData.get(player.eosID);
      const inactiveMs = record ? now - record.lastActivity : Infinity;

      members.push({
        name: player.name,
        inactiveMs,
        lastEvent: record ? record.lastEventType : 'Unknown'
      });
    }

    if (members.length === 0) {
      await this.server.rcon.warn(
        caller.eosID,
        `No players found in Team ${teamID} / Squad ${squadID}.`
      );
      return;
    }

    members.sort((a, b) => b.inactiveMs - a.inactiveMs);

    const label =
      teamID === caller.teamID ? `Squad ${squadID} Activity` : `Enemy Squad ${squadID} Activity`;
    const lines = [`--- ${label} ---`];
    for (const entry of members) {
      lines.push(
        `[${this.formatDuration(entry.inactiveMs)}] ${entry.name} (last: ${entry.lastEvent})`
      );
    }

    await this.sendWarns(caller.eosID, lines.join('\n'));
  }

  async lookupPlayer(caller, nameQuery) {
    const query = nameQuery.toLowerCase();
    const matches = this.server.players.filter(
      (p) => p.name && p.name.toLowerCase().includes(query)
    );

    if (matches.length === 0) {
      await this.server.rcon.warn(caller.eosID, `No player found matching "${nameQuery}".`);
      return;
    }

    if (matches.length > 1) {
      const names = matches.map((p) => p.name).join(', ');
      await this.server.rcon.warn(
        caller.eosID,
        `Multiple matches for "${nameQuery}": ${names}`
      );
      return;
    }

    const player = matches[0];
    const now = new Date();
    const record = this.activityData.get(player.eosID);
    const inactiveMs = record ? now - record.lastActivity : Infinity;
    const lastEvent = record ? record.lastEventType : 'Unknown';
    const duration = inactiveMs === Infinity ? 'N/A' : this.formatDuration(inactiveMs);

    const squadLabel = player.squadID != null ? player.squadID : 'Unassigned';

    const msg = [
      `--- AFK: ${player.name} ---`,
      `Inactive: ${duration} | Last: ${lastEvent}`,
      `Team: ${player.teamID} | Squad: ${squadLabel}`
    ].join('\n');

    await this.server.rcon.warn(caller.eosID, msg);
  }

  // --- Helpers ---

  formatDuration(ms) {
    if (!isFinite(ms)) return '??m';
    const totalMinutes = Math.floor(ms / 60000);
    if (totalMinutes < 60) return `${totalMinutes}m`;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h ${minutes}m`;
  }

  getOpposingTeam(teamID) {
    return teamID === 1 ? 2 : 1;
  }

  async sendWarns(eosID, fullMessage) {
    const lines = fullMessage.split('\n');
    const chunks = [];
    let chunk = '';

    for (const line of lines) {
      if (chunk && (chunk + '\n' + line).length > 450) {
        chunks.push(chunk);
        chunk = line;
      } else {
        chunk += (chunk ? '\n' : '') + line;
      }
    }
    if (chunk) chunks.push(chunk);

    for (const [i, page] of chunks.slice(0, this.options.maxPage).entries()) {
      if (i > 0) await new Promise((resolve) => setTimeout(resolve, 250));
      await this.server.rcon.warn(eosID, page);
    }
  }
}
