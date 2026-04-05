'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

type ColorName = 'Rouge' | 'Jaune' | 'Bleu' | 'Vert' | 'Violet';
type TeamRole = 'A' | 'B' | 'C';
type Role = TeamRole | 'ADMIN' | null;
type Side = 'left' | 'right';
type ResultType = 'gauche' | 'droite' | 'equilibre';

type GameRow = {
  id: string;
  started: boolean;
  current_team_index: number;
  current_order: number;
  time_left: number;
  message: string | null;
  validated_left: ColorName[] | null;
  validated_right: ColorName[] | null;
  validated_secondary_left: ColorName[] | null;
  validated_secondary_right: ColorName[] | null;
};

type PlayerRow = {
  id: string;
  game_id: string;
  pseudo: string;
  player_order: number;
  role: Role;
  is_admin: boolean;
  created_at?: string;
};

type MoveRow = {
  id: number;
  game_id: string;
  team: string;
  player: string;
  player_order: number;
  left_blocks: ColorName[];
  right_blocks: ColorName[];
  secondary_left_blocks: ColorName[];
  secondary_right_blocks: ColorName[];
  result: ResultType;
  created_at?: string;
};

const COLORS: { name: ColorName; badge: string }[] = [
  { name: 'Rouge', badge: 'bg-red-500/20 text-red-200 border border-red-400/20' },
  { name: 'Jaune', badge: 'bg-yellow-500/20 text-yellow-100 border border-yellow-300/30' },
  { name: 'Bleu', badge: 'bg-blue-500/20 text-blue-200 border border-blue-400/20' },
  { name: 'Vert', badge: 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/20' },
  { name: 'Violet', badge: 'bg-violet-500/20 text-violet-200 border border-violet-400/20' },
];

const WEIGHTS: Record<ColorName, number> = {
  Rouge: 2,
  Jaune: 10,
  Bleu: 16,
  Vert: 19,
  Violet: 7,
};

const TEAM_LABELS = ['Équipe A', 'Équipe B', 'Équipe C'] as const;
const TEAM_ROLES: TeamRole[] = ['A', 'B', 'C'];
const PLAYER_SECONDS = 5 * 60;
const BLOCKS_PER_PLAYER = 4;
const GAME_ID = 'salle-principale';
const SESSION_KEY = 'jeu-balance-session';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase: SupabaseClient | null =
  supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function normalizeBlocks(value: unknown): ColorName[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ColorName =>
    ['Rouge', 'Jaune', 'Bleu', 'Vert', 'Violet'].includes(String(item))
  );
}

export default function Page() {
  const [isReady, setIsReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pseudoInput, setPseudoInput] = useState('');
  const [orderInput, setOrderInput] = useState('1');
  const [selectedRole, setSelectedRole] = useState<Role>(null);
  const [message, setMessage] = useState('Connexion à la partie...');

  const [registeredPlayer, setRegisteredPlayer] = useState<PlayerRow | null>(null);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [history, setHistory] = useState<MoveRow[]>([]);
  const [game, setGame] = useState<GameRow | null>(null);

  const [left, setLeft] = useState<ColorName[]>([]);
  const [right, setRight] = useState<ColorName[]>([]);
  const [secondaryLeft, setSecondaryLeft] = useState<ColorName[]>([]);
  const [secondaryRight, setSecondaryRight] = useState<ColorName[]>([]);

  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const currentTeamIndex = game?.current_team_index ?? 0;
  const currentTeam = TEAM_LABELS[currentTeamIndex];
  const currentRole = TEAM_ROLES[currentTeamIndex];
  const currentOrder = game?.current_order ?? 1;
  const timeLeft = game?.time_left ?? PLAYER_SECONDS;
  const started = game?.started ?? false;

  const validatedLeft = normalizeBlocks(game?.validated_left ?? []);
  const validatedRight = normalizeBlocks(game?.validated_right ?? []);
  const validatedSecondaryLeft = normalizeBlocks(game?.validated_secondary_left ?? []);
  const validatedSecondaryRight = normalizeBlocks(game?.validated_secondary_right ?? []);

  const isAdmin = registeredPlayer?.is_admin ?? false;
  const isPlayer = !!registeredPlayer && !registeredPlayer.is_admin;
  const isMyTurn =
    !!registeredPlayer &&
    !registeredPlayer.is_admin &&
    registeredPlayer.role === currentRole &&
    registeredPlayer.player_order === currentOrder;

  const totalBlocks = left.length + right.length;

  const liveLeftWeight = useMemo(() => left.reduce((t, c) => t + WEIGHTS[c], 0), [left]);
  const liveRightWeight = useMemo(() => right.reduce((t, c) => t + WEIGHTS[c], 0), [right]);

  const result: ResultType =
    liveLeftWeight === liveRightWeight
      ? 'equilibre'
      : liveLeftWeight > liveRightWeight
      ? 'gauche'
      : 'droite';

  const validatedLeftWeight = useMemo(
    () => validatedLeft.reduce((t, c) => t + WEIGHTS[c], 0),
    [validatedLeft]
  );
  const validatedRightWeight = useMemo(
    () => validatedRight.reduce((t, c) => t + WEIGHTS[c], 0),
    [validatedRight]
  );
  const validatedSecondaryLeftWeight = useMemo(
    () => validatedSecondaryLeft.reduce((t, c) => t + WEIGHTS[c], 0),
    [validatedSecondaryLeft]
  );
  const validatedSecondaryRightWeight = useMemo(
    () => validatedSecondaryRight.reduce((t, c) => t + WEIGHTS[c], 0),
    [validatedSecondaryRight]
  );

  const angle =
    validatedLeftWeight === validatedRightWeight
      ? 0
      : validatedLeftWeight > validatedRightWeight
      ? Math.max(-16, -(validatedLeftWeight - validatedRightWeight) * 1.2)
      : Math.min(16, (validatedRightWeight - validatedLeftWeight) * 1.2);

  const secondaryAngle =
    validatedSecondaryLeftWeight === validatedSecondaryRightWeight
      ? 0
      : validatedSecondaryLeftWeight > validatedSecondaryRightWeight
      ? Math.max(-16, -(validatedSecondaryLeftWeight - validatedSecondaryRightWeight) * 1.2)
      : Math.min(16, (validatedSecondaryRightWeight - validatedSecondaryLeftWeight) * 1.2);

  const takenOrders = useMemo(
    () => players.filter((p) => !p.is_admin).map((p) => p.player_order).sort((a, b) => a - b),
    [players]
  );

  async function ensureGameExists() {
    if (!supabase) return;
    const { data } = await supabase.from('games').select('*').eq('id', GAME_ID).maybeSingle();

    if (!data) {
      await supabase.from('games').insert({
        id: GAME_ID,
        started: false,
        current_team_index: 0,
        current_order: 1,
        time_left: PLAYER_SECONDS,
        message: 'En attente du lancement par l’admin.',
        validated_left: [],
        validated_right: [],
        validated_secondary_left: [],
        validated_secondary_right: [],
      });
    }
  }

  async function loadAll() {
    if (!supabase) return;

    const [{ data: gameData }, { data: playerData }, { data: moveData }] = await Promise.all([
      supabase.from('games').select('*').eq('id', GAME_ID).single(),
      supabase
        .from('players')
        .select('*')
        .eq('game_id', GAME_ID)
        .order('player_order', { ascending: true }),
      supabase
        .from('moves')
        .select('*')
        .eq('game_id', GAME_ID)
        .order('id', { ascending: false })
        .limit(20),
    ]);

    if (gameData) {
      setGame({
        ...gameData,
        validated_left: normalizeBlocks(gameData.validated_left),
        validated_right: normalizeBlocks(gameData.validated_right),
        validated_secondary_left: normalizeBlocks(gameData.validated_secondary_left),
        validated_secondary_right: normalizeBlocks(gameData.validated_secondary_right),
      });
    }

    setPlayers((playerData ?? []) as PlayerRow[]);
    setHistory(
      ((moveData ?? []) as any[]).map((move) => ({
        ...move,
        left_blocks: normalizeBlocks(move.left_blocks),
        right_blocks: normalizeBlocks(move.right_blocks),
        secondary_left_blocks: normalizeBlocks(move.secondary_left_blocks),
        secondary_right_blocks: normalizeBlocks(move.secondary_right_blocks),
      }))
    );
  }

  async function restoreSession() {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(SESSION_KEY) : null;
    if (!saved || !supabase) return;

    try {
      const parsed = JSON.parse(saved) as { playerId?: string };
      if (!parsed.playerId) return;

      const { data } = await supabase
        .from('players')
        .select('*')
        .eq('id', parsed.playerId)
        .maybeSingle();

      if (data) {
        setRegisteredPlayer(data as PlayerRow);
      } else {
        localStorage.removeItem(SESSION_KEY);
      }
    } catch {
      localStorage.removeItem(SESSION_KEY);
    }
  }

  useEffect(() => {
    async function init() {
      if (!supabase) {
        setMessage(
          'Ajoute NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY dans ton projet.'
        );
        setLoading(false);
        setIsReady(true);
        return;
      }

      await ensureGameExists();
      await restoreSession();
      await loadAll();
      setLoading(false);
      setIsReady(true);
    }

    init();
  }, []);

  useEffect(() => {
    if (!supabase || !isReady) return;

    const gamesChannel = supabase
      .channel('games-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'games', filter: `id=eq.${GAME_ID}` },
        async () => {
          await loadAll();
        }
      )
      .subscribe();

    const playersChannel = supabase
      .channel('players-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'players', filter: `game_id=eq.${GAME_ID}` },
        async () => {
          await loadAll();
        }
      )
      .subscribe();

    const movesChannel = supabase
      .channel('moves-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'moves', filter: `game_id=eq.${GAME_ID}` },
        async () => {
          await loadAll();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(gamesChannel);
      supabase.removeChannel(playersChannel);
      supabase.removeChannel(movesChannel);
    };
  }, [isReady]);

  useEffect(() => {
    if (!supabase || !game || !started || !isAdmin) return;

    if (timerRef.current) clearInterval(timerRef.current);

    timerRef.current = setInterval(async () => {
      const currentTime = game.time_left;

      if (currentTime <= 1) {
        await goToNextTurn('Temps écoulé. Le tour passe au joueur suivant.');
      } else {
        await supabase.from('games').update({ time_left: currentTime - 1 }).eq('id', GAME_ID);
      }
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [game?.time_left, started, isAdmin]);

  async function registerPlayer() {
    if (!supabase) return;

    const pseudo = pseudoInput.trim();
    const order = Number(orderInput);

    if (!pseudo) {
      setMessage('Entre un pseudo.');
      return;
    }

    if (!selectedRole) {
      setMessage('Choisis une équipe ou le rôle admin.');
      return;
    }

    if (selectedRole !== 'ADMIN' && (!order || order < 1)) {
      setMessage('Choisis un ordre valide.');
      return;
    }

    if (selectedRole !== 'ADMIN') {
      const { data: existingOrder } = await supabase
        .from('players')
        .select('id')
        .eq('game_id', GAME_ID)
        .eq('player_order', order)
        .maybeSingle();

      if (existingOrder) {
        setMessage('Cet ordre est déjà pris.');
        return;
      }
    }

    const { data: existingPseudo } = await supabase
      .from('players')
      .select('id')
      .eq('game_id', GAME_ID)
      .eq('pseudo', pseudo)
      .maybeSingle();

    if (existingPseudo) {
      setMessage('Ce pseudo est déjà pris.');
      return;
    }

    if (selectedRole === 'ADMIN') {
      const { data: existingAdmin } = await supabase
        .from('players')
        .select('id')
        .eq('game_id', GAME_ID)
        .eq('is_admin', true)
        .maybeSingle();

      if (existingAdmin) {
        setMessage('Un admin est déjà connecté.');
        return;
      }
    }

    const payload = {
      game_id: GAME_ID,
      pseudo,
      player_order: selectedRole === 'ADMIN' ? 0 : order,
      role: selectedRole,
      is_admin: selectedRole === 'ADMIN',
    };

    const { data, error } = await supabase.from('players').insert(payload).select('*').single();

    if (error || !data) {
      setMessage('Impossible de rejoindre la partie.');
      return;
    }

    localStorage.setItem(SESSION_KEY, JSON.stringify({ playerId: data.id }));
    setRegisteredPlayer(data as PlayerRow);
    setMessage(
      selectedRole === 'ADMIN' ? 'Admin connecté.' : 'Joueur enregistré. En attente du lancement.'
    );
    await loadAll();
  }

  async function startGame() {
    if (!supabase || !isAdmin) return;

    await supabase
      .from('games')
      .update({
        started: true,
        current_team_index: 0,
        current_order: 1,
        time_left: PLAYER_SECONDS,
        message: 'La partie commence. Équipe A — Joueur 1.',
        validated_left: validatedLeft,
        validated_right: validatedRight,
        validated_secondary_left: validatedSecondaryLeft,
        validated_secondary_right: validatedSecondaryRight,
      })
      .eq('id', GAME_ID);
  }

  async function goToNextTurn(customMessage?: string) {
    if (!supabase || !game) return;

    const nextTeamIndex = (game.current_team_index + 1) % TEAM_LABELS.length;
    const nextOrder = nextTeamIndex === 0 ? game.current_order + 1 : game.current_order;

    await supabase
      .from('games')
      .update({
        current_team_index: nextTeamIndex,
        current_order: nextOrder,
        time_left: PLAYER_SECONDS,
        message: customMessage || 'Tour terminé. Joueur suivant.',
      })
      .eq('id', GAME_ID);
  }

  function addBlock(side: Side, color: ColorName) {
    if (!isMyTurn) {
      setMessage("Ce n'est pas ton tour.");
      return;
    }

    if (totalBlocks >= BLOCKS_PER_PLAYER) {
      setMessage(`Maximum ${BLOCKS_PER_PLAYER} blocs sur la balance principale pour ce joueur.`);
      return;
    }

    if (side === 'left') setLeft((prev) => [...prev, color]);
    else setRight((prev) => [...prev, color]);
  }

  function addSecondaryBlock(side: Side, color: ColorName) {
    if (!isMyTurn) {
      setMessage("Ce n'est pas ton tour.");
      return;
    }

    if (side === 'left') setSecondaryLeft((prev) => [...prev, color]);
    else setSecondaryRight((prev) => [...prev, color]);
  }

  function resetSecondary() {
    if (!isMyTurn) {
      setMessage("Ce n'est pas ton tour.");
      return;
    }

    setSecondaryLeft([]);
    setSecondaryRight([]);
  }

  async function validateRound() {
    if (!supabase || !registeredPlayer || !isMyTurn) {
      setMessage("Ce n'est pas ton tour.");
      return;
    }

    if (totalBlocks < 2) {
      setMessage('Il faut placer au minimum 2 blocs.');
      return;
    }

    await supabase.from('moves').insert({
      game_id: GAME_ID,
      team: currentTeam,
      player: registeredPlayer.pseudo,
      player_order: registeredPlayer.player_order,
      left_blocks: left,
      right_blocks: right,
      secondary_left_blocks: secondaryLeft,
      secondary_right_blocks: secondaryRight,
      result,
    });

    await supabase
      .from('games')
      .update({
        validated_left: left,
        validated_right: right,
        message:
          result === 'equilibre'
            ? `${currentTeam} a validé un équilibre parfait.`
            : result === 'gauche'
            ? `${currentTeam} a validé : la gauche est plus lourde.`
            : `${currentTeam} a validé : la droite est plus lourde.`,
      })
      .eq('id', GAME_ID);
  }

  async function finishTurn() {
    if (!supabase || (!isMyTurn && !isAdmin)) {
      setMessage(isAdmin ? 'Action impossible.' : "Ce n'est pas ton tour.");
      return;
    }

    if (!isAdmin) {
      await supabase
        .from('games')
        .update({
          validated_left: left,
          validated_right: right,
          validated_secondary_left: secondaryLeft,
          validated_secondary_right: secondaryRight,
        })
        .eq('id', GAME_ID);
    }

    await goToNextTurn(
      isAdmin ? `L'admin a passé le tour du joueur.` : `${currentTeam} a terminé son tour.`
    );
  }

  async function endGame() {
    if (!supabase || !isAdmin) {
      setMessage("Seul l'admin peut terminer la partie.");
      return;
    }

    await supabase
      .from('games')
      .update({
        started: false,
        current_team_index: 0,
        current_order: 1,
        time_left: PLAYER_SECONDS,
        message: "L'admin a mis fin à la partie.",
      })
      .eq('id', GAME_ID);
  }

  const renderBlocks = (blocks: ColorName[]) => {
    if (blocks.length === 0) return <span className="text-slate-400">Vide</span>;

    return (
      <div className="flex flex-wrap items-center justify-center gap-2">
        {blocks.map((block, index) => {
          const colorConfig = COLORS.find((c) => c.name === block);
          return (
            <span
              key={`${block}-${index}`}
              className={`rounded-full px-3 py-1 text-sm font-medium ${colorConfig?.badge}`}
            >
              {block}
            </span>
          );
        })}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <h1 className="text-3xl font-bold">Chargement...</h1>
          <p className="text-slate-400">Connexion à la salle en cours.</p>
        </div>
      </div>
    );
  }

  if (!supabase) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
        <div className="max-w-2xl rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl space-y-4">
          <h1 className="text-3xl font-bold">Configuration Supabase manquante</h1>
          <p className="text-slate-300">
            Ajoute <code>NEXT_PUBLIC_SUPABASE_URL</code> et{' '}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> dans ton projet.
          </p>
        </div>
      </div>
    );
  }

  if (!registeredPlayer) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
        <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl space-y-6 text-center">
          <div className="inline-block rounded-full bg-yellow-500/20 px-4 py-1 text-sm text-yellow-100 border border-yellow-300/20">
            Le Jeu de la Balance
          </div>
          <h1 className="text-4xl font-bold">Rejoindre la partie</h1>
          <p className="text-slate-300">Tous les joueurs sont connectés en direct dans la même salle.</p>

          <input
            value={pseudoInput}
            onChange={(e) => setPseudoInput(e.target.value)}
            placeholder="Ton pseudo"
            className="w-full rounded-2xl bg-slate-900 border border-white/10 px-4 py-3 text-white outline-none"
          />

          <input
            value={orderInput}
            onChange={(e) => setOrderInput(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="Ordre de passage"
            className="w-full rounded-2xl bg-slate-900 border border-white/10 px-4 py-3 text-white outline-none"
          />

          <div className="grid md:grid-cols-2 gap-4">
            <button
              onClick={() => setSelectedRole('A')}
              className={`rounded-2xl px-6 py-4 text-lg font-semibold border transition ${
                selectedRole === 'A'
                  ? 'bg-blue-500/30 text-blue-100 border-blue-300/30'
                  : 'bg-blue-500/10 text-blue-100 border-blue-300/10'
              }`}
            >
              Équipe A
            </button>
            <button
              onClick={() => setSelectedRole('B')}
              className={`rounded-2xl px-6 py-4 text-lg font-semibold border transition ${
                selectedRole === 'B'
                  ? 'bg-cyan-500/30 text-cyan-100 border-cyan-300/30'
                  : 'bg-cyan-500/10 text-cyan-100 border-cyan-300/10'
              }`}
            >
              Équipe B
            </button>
            <button
              onClick={() => setSelectedRole('C')}
              className={`rounded-2xl px-6 py-4 text-lg font-semibold border transition ${
                selectedRole === 'C'
                  ? 'bg-emerald-500/30 text-emerald-100 border-emerald-300/30'
                  : 'bg-emerald-500/10 text-emerald-100 border-emerald-300/10'
              }`}
            >
              Équipe C
            </button>
            <button
              onClick={() => setSelectedRole('ADMIN')}
              className={`rounded-2xl px-6 py-4 text-lg font-semibold border transition ${
                selectedRole === 'ADMIN'
                  ? 'bg-yellow-500/30 text-yellow-100 border-yellow-300/30'
                  : 'bg-yellow-500/10 text-yellow-100 border-yellow-300/10'
              }`}
            >
              Admin / Spec
            </button>
          </div>

          <div className="rounded-2xl bg-white/5 p-4 text-left">
            <p className="text-sm text-slate-400 mb-2">Ordres déjà pris</p>
            <div className="flex flex-wrap gap-2">
              {takenOrders.length === 0 ? (
                <span className="text-slate-400">Aucun pour le moment</span>
              ) : (
                takenOrders.map((order) => (
                  <span
                    key={order}
                    className="rounded-full bg-rose-500/10 border border-rose-400/20 px-3 py-1 text-sm text-rose-100"
                  >
                    {order}
                  </span>
                ))
              )}
            </div>
          </div>

          <button
            onClick={registerPlayer}
            className="w-full rounded-2xl bg-yellow-500/20 px-4 py-3 font-semibold text-yellow-100 border border-yellow-300/20 hover:bg-yellow-500/30 transition"
          >
            Rejoindre
          </button>

          <div className="text-sm text-cyan-100">{message}</div>
        </div>
      </div>
    );
  }

  if (!started) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
        <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl space-y-6 text-center">
          <h1 className="text-4xl font-bold">Salle d’attente</h1>
          <p className="text-slate-300">Tous les joueurs attendent. Seul l’admin peut lancer la partie.</p>

          <div className="rounded-2xl bg-white/5 p-4 text-left">
            <p className="text-sm text-slate-400 mb-3">Joueurs connectés</p>
            <div className="space-y-2">
              {players.length === 0 ? (
                <p className="text-slate-400">Personne n’a rejoint la salle.</p>
              ) : (
                players.map((player) => (
                  <div
                    key={player.id}
                    className="rounded-xl bg-slate-900 p-3 flex items-center justify-between gap-3"
                  >
                    <span>{player.pseudo}</span>
                    <span className="text-slate-400 text-sm">
                      {player.is_admin
                        ? 'Admin'
                        : `Équipe ${player.role} · Ordre ${player.player_order}`}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {isAdmin ? (
            <button
              onClick={startGame}
              className="rounded-2xl bg-emerald-500/20 px-6 py-3 text-emerald-100 font-semibold border border-emerald-300/20 hover:bg-emerald-500/30 transition"
            >
              Lancer la partie
            </button>
          ) : (
            <p className="text-slate-400">L’admin doit lancer la partie...</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6 md:p-10">
      <div className="max-w-7xl mx-auto space-y-8">
        <header className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-block rounded-full bg-yellow-500/20 px-4 py-1 text-sm text-yellow-100 border border-yellow-300/20">
              Version temps réel
            </div>
            <div className="rounded-full bg-white/5 px-4 py-2 text-sm text-slate-300 border border-white/10">
              {registeredPlayer.pseudo} —{' '}
              {isAdmin
                ? 'Admin / Spec'
                : `Équipe ${registeredPlayer.role} · Ordre ${registeredPlayer.player_order}`}
            </div>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold">Le Jeu de la Balance</h1>
          <p className="text-slate-300 max-w-3xl text-lg">
            Tous les joueurs sont connectés en direct. L’admin lance la partie pour tout le
            monde, l’ordre est bloqué globalement, seul le joueur actif peut jouer, et les blocs
            restent visibles sur les deux balances d’un tour à l’autre.
          </p>
        </header>

        <section className="grid md:grid-cols-4 gap-4">
          {['3 équipes', '1 admin / spec', '5 minutes par joueur', '4 blocs max par joueur'].map(
            (item) => (
              <div
                key={item}
                className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-lg"
              >
                <p className="text-lg font-semibold">{item}</p>
              </div>
            )
          )}
        </section>

        <section className="grid xl:grid-cols-2 gap-6">
          <div className="rounded-3xl border border-yellow-300/20 bg-yellow-500/5 p-6 shadow-2xl space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold text-yellow-100">Balance principale</h2>
                <p className="text-slate-300 mt-2">Elle ne s’incline qu’après validation du tour.</p>
              </div>
              <div className="rounded-2xl bg-yellow-500/15 px-4 py-3 text-yellow-100 font-semibold border border-yellow-300/20">
                {currentTeam} — Joueur {currentOrder}
              </div>
            </div>

            <div className="rounded-3xl bg-slate-900/90 p-6 min-h-[360px] flex flex-col justify-between border border-yellow-300/10">
              <div className="text-center text-yellow-100 text-sm">
                Indice : le jaune est la 3ᵉ couleur la plus lourde et pèse 10.
              </div>

              <div className="relative h-[230px] overflow-hidden flex items-center justify-center">
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-5 h-32 rounded-full bg-yellow-300/70" />
                <div
                  className="absolute top-20 left-1/2 h-3 w-[60%] -translate-x-1/2 rounded-full bg-yellow-200 shadow-[0_0_30px_rgba(250,204,21,0.25)] transition-transform duration-500"
                  style={{ transform: `translateX(-50%) rotate(${angle}deg)` }}
                />
                <div
                  className="absolute left-1/2 -translate-x-[120%] w-40 rounded-2xl bg-slate-800/95 p-4 text-center transition-all duration-500 border border-yellow-300/10"
                  style={{ top: `${120 + angle * 2}px` }}
                >
                  <p className="mb-2 text-sm text-slate-400">Gauche</p>
                  {renderBlocks(validatedLeft)}
                </div>
                <div
                  className="absolute left-1/2 translate-x-[20%] w-40 rounded-2xl bg-slate-800/95 p-4 text-center transition-all duration-500 border border-yellow-300/10"
                  style={{ top: `${120 - angle * 2}px` }}
                >
                  <p className="mb-2 text-sm text-slate-400">Droite</p>
                  {renderBlocks(validatedRight)}
                </div>
              </div>

              <div className="grid md:grid-cols-3 gap-3">
                <div className="rounded-2xl bg-white/5 p-4">
                  <p className="text-sm text-slate-400">Résultat préparé</p>
                  <p className="text-lg font-semibold mt-1">
                    {result === 'equilibre'
                      ? 'Équilibre parfait'
                      : result === 'gauche'
                      ? 'La gauche sera plus lourde'
                      : 'La droite sera plus lourde'}
                  </p>
                </div>
                <div className="rounded-2xl bg-white/5 p-4">
                  <p className="text-sm text-slate-400">Blocs utilisés</p>
                  <p className="text-lg font-semibold mt-1">{totalBlocks} / 4 blocs</p>
                </div>
                <div className="rounded-2xl bg-white/5 p-4">
                  <p className="text-sm text-slate-400">Temps restant</p>
                  <p className="text-lg font-semibold mt-1 text-yellow-100">
                    {formatTime(timeLeft)}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl space-y-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold">Balance secondaire</h2>
                <p className="text-slate-300 mt-2">
                  Elle sert de test. Elle n’a pas besoin d’être équilibrée, et elle ne bouge qu’à
                  la fin du tour.
                </p>
              </div>
              {!isAdmin && (
                <button
                  onClick={resetSecondary}
                  disabled={!isMyTurn}
                  className="rounded-xl bg-white/10 px-4 py-2 font-medium hover:bg-white/15 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Réinitialiser
                </button>
              )}
            </div>

            <div className="rounded-3xl bg-slate-900 p-6 min-h-[360px] flex flex-col justify-between">
              <div className="text-center text-slate-400 text-sm">
                Zone d’aide pour les calculs des joueurs
              </div>

              <div className="relative h-[230px] overflow-hidden flex items-center justify-center">
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-5 h-32 rounded-full bg-slate-500" />
                <div
                  className="absolute top-20 left-1/2 h-3 w-[60%] -translate-x-1/2 rounded-full bg-slate-300 transition-transform duration-500"
                  style={{ transform: `translateX(-50%) rotate(${secondaryAngle}deg)` }}
                />
                <div
                  className="absolute left-1/2 -translate-x-[120%] w-40 rounded-2xl bg-slate-800/95 p-4 text-center transition-all duration-500"
                  style={{ top: `${120 + secondaryAngle * 2}px` }}
                >
                  <p className="mb-2 text-sm text-slate-400">Gauche</p>
                  {renderBlocks(validatedSecondaryLeft)}
                </div>
                <div
                  className="absolute left-1/2 translate-x-[20%] w-40 rounded-2xl bg-slate-800/95 p-4 text-center transition-all duration-500"
                  style={{ top: `${120 - secondaryAngle * 2}px` }}
                >
                  <p className="mb-2 text-sm text-slate-400">Droite</p>
                  {renderBlocks(validatedSecondaryRight)}
                </div>
              </div>

              <div className="rounded-2xl bg-white/5 p-4 text-slate-300">
                Les blocs posés ici restent visibles. La balance secondaire ne s’incline qu’après
                avoir appuyé sur Fin de tour.
              </div>
            </div>
          </div>
        </section>

        {isPlayer && (
          <section className="grid xl:grid-cols-2 gap-6">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl space-y-4">
              <h2 className="text-2xl font-semibold">Préparer la balance principale</h2>

              {!isMyTurn && (
                <div className="rounded-2xl bg-rose-500/10 border border-rose-400/20 p-4 text-rose-100">
                  Ce n’est pas ton tour. Le joueur actif est {currentTeam} — Joueur {currentOrder}.
                </div>
              )}

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={validateRound}
                  disabled={!isMyTurn}
                  className="rounded-xl bg-emerald-500/20 px-4 py-2 text-emerald-200 font-medium hover:bg-emerald-500/30 transition border border-emerald-300/20 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Valider le choix
                </button>
                <button
                  onClick={finishTurn}
                  disabled={!isMyTurn}
                  className="rounded-xl bg-white/10 px-4 py-2 text-white font-medium hover:bg-white/15 transition border border-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Fin de tour
                </button>
              </div>

              <div className="space-y-3">
                {COLORS.map((color) => (
                  <div key={color.name} className="rounded-2xl bg-slate-900 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold">{color.name}</span>
                      <span className="text-slate-400 text-sm">1 clic = 1 bloc</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => addBlock('left', color.name)}
                        disabled={!isMyTurn}
                        className="flex-1 rounded-xl bg-yellow-500/20 px-3 py-2 text-yellow-100 font-medium hover:bg-yellow-500/30 transition border border-yellow-300/20 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        + gauche
                      </button>
                      <button
                        onClick={() => addBlock('right', color.name)}
                        disabled={!isMyTurn}
                        className="flex-1 rounded-xl bg-yellow-500/10 px-3 py-2 text-yellow-100 font-medium hover:bg-yellow-500/20 transition border border-yellow-300/20 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        + droite
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl space-y-4">
              <h2 className="text-2xl font-semibold">Préparer la balance secondaire</h2>

              <div className="space-y-3">
                {COLORS.map((color) => (
                  <div
                    key={`secondary-${color.name}`}
                    className="rounded-2xl bg-slate-900 p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold">{color.name}</span>
                      <span className="text-slate-400 text-sm">Aide</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => addSecondaryBlock('left', color.name)}
                        disabled={!isMyTurn}
                        className="flex-1 rounded-xl bg-blue-500/20 px-3 py-2 text-blue-100 font-medium hover:bg-blue-500/30 transition border border-blue-300/20 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        + gauche
                      </button>
                      <button
                        onClick={() => addSecondaryBlock('right', color.name)}
                        disabled={!isMyTurn}
                        className="flex-1 rounded-xl bg-blue-500/10 px-3 py-2 text-blue-100 font-medium hover:bg-blue-500/20 transition border border-blue-300/20 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        + droite
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {isAdmin && (
          <section className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl space-y-4">
            <h2 className="text-2xl font-semibold">Actions admin</h2>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={finishTurn}
                className="rounded-xl bg-white/10 px-4 py-2 text-white font-medium hover:bg-white/15 transition border border-white/10"
              >
                Passer le tour du joueur
              </button>
              <button
                onClick={endGame}
                className="rounded-xl bg-rose-500/20 px-4 py-2 text-rose-100 font-medium hover:bg-rose-500/30 transition border border-rose-300/20"
              >
                Mettre fin à la partie
              </button>
            </div>
          </section>
        )}

        <section className="grid xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2 rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl space-y-4">
            <h2 className="text-2xl font-semibold">Écran commun</h2>
            <div className="rounded-2xl bg-slate-900 p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-slate-400">Tour actuel</p>
                  <p className="text-xl font-bold">
                    {currentTeam} — Joueur {currentOrder}
                  </p>
                </div>
                <div className="rounded-full bg-yellow-500/20 px-4 py-2 text-yellow-100 font-semibold border border-yellow-300/20">
                  {formatTime(timeLeft)}
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="rounded-2xl bg-white/5 p-4">
                  <p className="text-sm text-slate-400 mb-2">Balance principale en préparation</p>
                  {renderBlocks(left)}
                </div>
                <div className="rounded-2xl bg-white/5 p-4">
                  <p className="text-sm text-slate-400 mb-2">Balance secondaire en préparation</p>
                  <div className="space-y-2">
                    <div>{renderBlocks(secondaryLeft)}</div>
                    <div>{renderBlocks(secondaryRight)}</div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl bg-cyan-500/10 border border-cyan-400/20 p-4 text-cyan-100">
                {game?.message || message}
              </div>

              {isPlayer && (
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={validateRound}
                    disabled={!isMyTurn}
                    className="rounded-xl bg-emerald-500/20 px-4 py-2 text-emerald-200 font-medium hover:bg-emerald-500/30 transition border border-emerald-300/20 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Valider le choix
                  </button>
                  <button
                    onClick={finishTurn}
                    disabled={!isMyTurn}
                    className="rounded-xl bg-white/10 px-4 py-2 text-white font-medium hover:bg-white/15 transition border border-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Fin de tour
                  </button>
                </div>
              )}

              {isAdmin && (
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={finishTurn}
                    className="rounded-xl bg-white/10 px-4 py-2 text-white font-medium hover:bg-white/15 transition border border-white/10"
                  >
                    Passer le tour du joueur
                  </button>
                  <button
                    onClick={endGame}
                    className="rounded-xl bg-rose-500/20 px-4 py-2 text-rose-100 font-medium hover:bg-rose-500/30 transition border border-rose-300/20"
                  >
                    Mettre fin à la partie
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl space-y-4">
            <h2 className="text-2xl font-semibold">Infos salle</h2>
            <div className="space-y-3 text-slate-300">
              <div className="rounded-2xl bg-slate-900 p-4">
                <p className="text-sm text-slate-400">Pseudo</p>
                <p className="text-xl font-bold">{registeredPlayer.pseudo}</p>
              </div>
              <div className="rounded-2xl bg-slate-900 p-4">
                <p className="text-sm text-slate-400">Rôle</p>
                <p className="text-xl font-bold">
                  {isAdmin
                    ? 'Admin / Spec'
                    : `Équipe ${registeredPlayer.role} · Ordre ${registeredPlayer.player_order}`}
                </p>
              </div>
              <div className="rounded-2xl bg-slate-900 p-4">
                <p className="text-sm text-slate-400">Ordres bloqués</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {takenOrders.length === 0 ? (
                    <span className="text-slate-400">Aucun</span>
                  ) : (
                    takenOrders.map((order) => (
                      <span
                        key={order}
                        className="rounded-full bg-rose-500/10 border border-rose-400/20 px-3 py-1 text-sm text-rose-100"
                      >
                        {order}
                      </span>
                    ))
                  )}
                </div>
              </div>
              <div className="rounded-2xl bg-slate-900 p-4">
                <p className="text-sm text-slate-400">Statut</p>
                <p className="text-lg font-semibold">
                  {isAdmin ? 'Observation' : isMyTurn ? 'À toi de jouer' : 'En attente'}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl space-y-4">
          <h2 className="text-2xl font-semibold">Historique des validations</h2>
          <div className="grid lg:grid-cols-2 gap-4">
            {history.length === 0 ? (
              <div className="rounded-2xl bg-slate-900 p-4 text-slate-400">
                Aucune validation pour le moment.
              </div>
            ) : (
              history.map((entry) => (
                <div key={entry.id} className="rounded-2xl bg-slate-900 p-4 space-y-2">
                  <p className="font-semibold">
                    {entry.team} — {entry.player} — Ordre {entry.player_order}
                  </p>
                  <p className="text-slate-300 text-sm">
                    Principale gauche : {entry.left_blocks.join(', ') || 'Vide'}
                  </p>
                  <p className="text-slate-300 text-sm">
                    Principale droite : {entry.right_blocks.join(', ') || 'Vide'}
                  </p>
                  <p className="text-slate-300 text-sm">
                    Secondaire gauche : {entry.secondary_left_blocks.join(', ') || 'Vide'}
                  </p>
                  <p className="text-slate-300 text-sm">
                    Secondaire droite : {entry.secondary_right_blocks.join(', ') || 'Vide'}
                  </p>
                  <p className="text-sm text-cyan-200">
                    {entry.result === 'equilibre'
                      ? 'Résultat : équilibre parfait'
                      : entry.result === 'gauche'
                      ? 'Résultat : la gauche était plus lourde'
                      : 'Résultat : la droite était plus lourde'}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}