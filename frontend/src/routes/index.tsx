import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useMemo, useRef, useState, type PointerEvent } from "react";
import {
  LayoutDashboard, FileText, Bell, FileBarChart, Settings, PanelLeftClose,
  Search, Flag, ChevronDown, Calendar, Filter,
  Plus, Minus, Maximize2, Lock, RefreshCw, Expand,
  Building2, ArrowUpRight, ArrowDownLeft, ArrowLeftRight, Shield,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Transaction Flow Analysis | Financial Intelligence Unit" },
      { name: "description", content: "Visualize money flow between accounts and identify key transaction patterns — FIU India." },
    ],
  }),
  loader: () => getAccountStatements(),
  component: Dashboard,
});

const navItems = [
  { icon: LayoutDashboard, label: "Dashboard" },
  { icon: FileText, label: "Account Statements" },
  { icon: Bell, label: "Alerts" },
  { icon: FileBarChart, label: "Reports" },
  { icon: Settings, label: "Settings" },
];

type AppView = (typeof navItems)[number]["label"];

type AccountStatement = {
  name: string;
  accountId: string;
  accountName: string;
  transactions: Transaction[];
};

type Transaction = {
  transactionId: string;
  fileName: string;
  transactionType: string;
  mode: string;
  fromAccount: string;
  fromName: string;
  toAccount: string;
  toName: string;
  amount: number;
  date: string;
  time: string;
  savingsBalance: number;
};

type GraphNode = {
  id: string;
  name: string;
  x: number;
  y: number;
  amount: number;
  count: number;
  type: "in" | "out" | "internal";
  linkedCenterId: string;
  transactionIds: string[];
};

type CenterCard = {
  id: string;
  name: string;
  amount: number;
  count: number;
  x: number;
  y: number;
};

type CenterLink = {
  fromId: string;
  toId: string;
  amount: number;
  count: number;
  flowType: "credit" | "debit";
  transactionIds: string[];
};

type FlowDetail = {
  from: string;
  to: string;
  amount: number;
  transactionIds: string[];
  x: number;
  y: number;
};

type FlaggedAccount = {
  id: string;
  name: string;
  flag: "Circular Loop" | "Potential Loop" | "Dormant Account";
  accountIds: string[];
  transactionIds: string[];
  detail: string;
  amount: number;
};

type MoneyFlowGraph = {
  centerId: string;
  centerName: string;
  centerAmount: number;
  centerCards: CenterCard[];
  nodes: GraphNode[];
  totalTransactions: number;
  totalAccounts: number;
  totalAmount: number;
  incomingCount: number;
  outgoingCount: number;
  internalCount: number;
  flaggedCount: number;
  dateRange: string;
};

type DragState = {
  id: string;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
};

type CanvasDragState = {
  clientX: number;
  clientY: number;
  viewBox: ViewBoxState;
};

type ViewBoxState = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type GraphLayoutOptions = {
  spacious?: boolean;
};

const getAccountStatements = createServerFn({ method: "GET" }).handler(async () => {
  const [{ readFile, readdir }, path] = await Promise.all([
    import("node:fs/promises"),
    import("node:path"),
  ]);
  const accountStatementsDir = path.resolve(process.cwd(), "..", "account_data", "generated_accounts");
  const entries = await readdir(accountStatementsDir, { withFileTypes: true });

  const fileNames = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".csv"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  return Promise.all(
    fileNames.map(async (name) => {
      const csv = await readFile(path.join(accountStatementsDir, name), "utf8");
      return parseAccountStatement(name, csv);
    }),
  );
});

function parseAccountStatement(fileName: string, csv: string): AccountStatement {
  const [headerLine, ...rows] = csv.trim().split(/\r?\n/);
  const headers = parseCsvLine(headerLine);
  const indexByHeader = new Map(headers.map((header, index) => [header, index]));
  const accountId = fileName.replace(/\.csv$/i, "");
  const transactions = rows
    .map((row) => parseTransaction(fileName, parseCsvLine(row), indexByHeader))
    .filter((transaction): transaction is Transaction => Boolean(transaction));
  const accountName =
    transactions.find((transaction) => transaction.toAccount === accountId)?.toName ??
    transactions.find((transaction) => transaction.fromAccount === accountId)?.fromName ??
    "Unknown Account";

  return { name: fileName, accountId, accountName, transactions };
}

function parseTransaction(
  fileName: string,
  row: string[],
  indexByHeader: Map<string, number>,
): Transaction | null {
  const field = (header: string) => row[indexByHeader.get(header) ?? -1]?.trim() ?? "";
  const amount = Number(field("Amount"));

  if (!Number.isFinite(amount)) return null;

  return {
    transactionId:
      field("Transaction ID") ||
      field("Transaction Id") ||
      field("Txn ID") ||
      field("Txn Id") ||
      `${fileName.replace(/\.csv$/i, "")}-${field("Sl No")}`,
    fileName,
    transactionType: field("Transaction Type"),
    mode: field("Mode"),
    fromAccount: field("From Account"),
    fromName: field("From Name"),
    toAccount: field("To Account"),
    toName: field("To Name"),
    amount,
    date: field("Date"),
    time: field("Time"),
    savingsBalance: Number(field("Savings Balance")) || 0,
  };
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"' && nextChar === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      values.push(value);
      value = "";
    } else {
      value += char;
    }
  }

  values.push(value);
  return values;
}

const GRAPH_WIDTH = 1400;
const GRAPH_HEIGHT = 900;
const NODE_WIDTH = 160;
const NODE_HEIGHT = 56;
const CENTER_WIDTH = 220;
const CENTER_HEIGHT = 84;
const CX = GRAPH_WIDTH / 2;
const CY = GRAPH_HEIGHT / 2;
const MAX_GRAPH_NODES = 30;
const MAX_FLAGGED_ACCOUNTS = 80;
const INITIAL_VIEW_BOX: ViewBoxState = { x: -90, y: 0, width: GRAPH_WIDTH, height: GRAPH_HEIGHT };

function curve(x1: number, y1: number, x2: number, y2: number) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2 - 40;
  return `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`;
}

function buildMoneyFlowGraph(
  selectedStatements: AccountStatement[],
  layoutOptions: GraphLayoutOptions = {},
): MoneyFlowGraph {
  const selectedAccounts = new Set(selectedStatements.map((statement) => statement.accountId));
  const aggregate = new Map<string, Omit<GraphNode, "x" | "y">>();
  const transactions = selectedStatements.flatMap((statement) => statement.transactions);
  const allAccounts = new Set<string>();
  let incomingCount = 0;
  let outgoingCount = 0;
  let internalCount = 0;

  for (const transaction of transactions) {
    const fromSelected = selectedAccounts.has(transaction.fromAccount);
    const toSelected = selectedAccounts.has(transaction.toAccount);
    if (!fromSelected && !toSelected) continue;

    allAccounts.add(transaction.fromAccount);
    allAccounts.add(transaction.toAccount);

    const type = fromSelected && toSelected ? "internal" : toSelected ? "in" : "out";
    if (type === "internal") {
      internalCount += 1;
      continue;
    }

    const linkedCenterId = type === "in" ? transaction.toAccount : transaction.fromAccount;
    const counterpartyId = type === "in" ? transaction.fromAccount : transaction.toAccount;
    const counterpartyName = type === "in" ? transaction.fromName : transaction.toName;
    const key = `${type}:${linkedCenterId}:${counterpartyId}`;
    const current =
      aggregate.get(key) ??
      {
        id: counterpartyId,
        name: counterpartyName,
        amount: 0,
        count: 0,
        type,
        linkedCenterId,
        transactionIds: [],
      };

    current.amount += transaction.amount;
    current.count += 1;
    current.transactionIds.push(transaction.transactionId);
    aggregate.set(key, current);

    if (type === "in") incomingCount += 1;
    if (type === "out") outgoingCount += 1;
  }

  const totalAmount = transactions.reduce((sum, transaction) => sum + transaction.amount, 0);
  const dates = transactions.map((transaction) => transaction.date).filter(Boolean).sort();
  const centerCards = buildCenterCards(selectedStatements, transactions, layoutOptions);
  const nodes = Array.from(aggregate.values())
    .sort((a, b) => b.amount - a.amount)
    .slice(0, MAX_GRAPH_NODES);
  const positionedNodes = positionExternalNodes(nodes, centerCards);

  return {
    centerId:
      selectedStatements.length === 1
        ? selectedStatements[0].accountId
        : `${selectedStatements.length} selected accounts`,
    centerName:
      selectedStatements.length === 1
        ? selectedStatements[0].accountName
        : `${selectedStatements.length} account statements`,
    centerAmount: totalAmount,
    centerCards,
    nodes: positionedNodes,
    totalTransactions: transactions.length,
    totalAccounts: allAccounts.size || selectedAccounts.size,
    totalAmount,
    incomingCount,
    outgoingCount,
    internalCount,
    flaggedCount: transactions.filter((transaction) => transaction.amount >= 100000).length,
    dateRange: dates.length ? `${formatShortDate(dates[0])} to ${formatShortDate(dates[dates.length - 1])}` : "No dates",
  };
}

function buildCenterCards(
  statements: AccountStatement[],
  transactions: Transaction[],
  layoutOptions: GraphLayoutOptions = {},
): CenterCard[] {
  if (statements.length === 0) {
    return [
      {
        id: "no-selection",
        name: "No account selected",
        amount: 0,
        count: 0,
        x: CX - CENTER_WIDTH / 2,
        y: CY - CENTER_HEIGHT / 2,
      },
    ];
  }

  const positions = layoutCenterCards(statements.length, layoutOptions);

  return statements.map((statement, index) => {
    const accountTransactions = transactions.filter(
      (transaction) =>
        transaction.fromAccount === statement.accountId || transaction.toAccount === statement.accountId,
    );

    return {
      id: statement.accountId,
      name: statement.accountName,
      amount: accountTransactions.reduce((sum, transaction) => sum + transaction.amount, 0),
      count: accountTransactions.length,
      x: positions[index].x,
      y: positions[index].y,
    };
  });
}

function layoutCenterCards(count: number, { spacious = false }: GraphLayoutOptions = {}): Array<{ x: number; y: number }> {
  if (count <= 0) return [];

  const gapX = spacious ? 220 : 120;
  const gapY = spacious ? 150 : 100;
  const columns = count <= 3 ? count : Math.min(3, Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / columns);
  const clusterWidth = columns * CENTER_WIDTH + (columns - 1) * gapX;
  const clusterHeight = rows * CENTER_HEIGHT + (rows - 1) * gapY;
  const startX = CX - clusterWidth / 2;
  const startY = CY - clusterHeight / 2;

  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const rowColumns = Math.min(columns, count - row * columns);
    const rowOffset = ((columns - rowColumns) * (CENTER_WIDTH + gapX)) / 2;

    return {
      x: startX + rowOffset + column * (CENTER_WIDTH + gapX),
      y: startY + row * (CENTER_HEIGHT + gapY),
    };
  });
}

function positionExternalNodes(nodes: Omit<GraphNode, "x" | "y">[], centerCards: CenterCard[]): GraphNode[] {
  if (nodes.length === 0) return [];

  const grouped = new Map<string, Omit<GraphNode, "x" | "y">[]>();
  for (const node of nodes) {
    const key = `${node.linkedCenterId}:${node.type}`;
    grouped.set(key, [...(grouped.get(key) ?? []), node]);
  }

  const positioned: GraphNode[] = [];
  for (const [key, group] of grouped) {
    const [centerId, type] = key.split(":");
    const center = centerCards.find((card) => card.id === centerId) ?? centerCards[0];
    const side = type === "in" ? "left" : "right";
    const x = side === "left" ? 0 : GRAPH_WIDTH - NODE_WIDTH;
    const anchorY = center ? center.y + CENTER_HEIGHT / 2 : CY;
    const yPositions = distributeAround(anchorY, group.length, NODE_HEIGHT, 18);

    group.forEach((node, index) => {
      positioned.push({
        ...node,
        x,
        y: clamp(yPositions[index], 0, GRAPH_HEIGHT - NODE_HEIGHT),
      });
    });
  }

  return positioned;
}

function centerCardKey(id: string) {
  return `center:${id}`;
}

function graphNodeKey(node: Pick<GraphNode, "id" | "type" | "linkedCenterId">) {
  return `${node.type}:${node.linkedCenterId}:${node.id}`;
}

function nearestCenterCard(node: GraphNode, cards: CenterCard[]) {
  return (
    cards.find((card) => card.id === node.linkedCenterId) ??
    cards.reduce((nearest, card) => {
      const nearestDistance = Math.abs(nearest.y + CENTER_HEIGHT / 2 - (node.y + NODE_HEIGHT / 2));
      const cardDistance = Math.abs(card.y + CENTER_HEIGHT / 2 - (node.y + NODE_HEIGHT / 2));
      return cardDistance < nearestDistance ? card : nearest;
    }, cards[0])
  );
}

function buildCenterLinks(cards: CenterCard[], statements: AccountStatement[]): CenterLink[] {
  const visibleIds = new Set(cards.map((card) => card.id));
  const links = new Map<string, CenterLink>();

  for (const statement of statements) {
    for (const transaction of statement.transactions) {
      if (!visibleIds.has(transaction.fromAccount) || !visibleIds.has(transaction.toAccount)) continue;

      const key = `${transaction.fromAccount}:${transaction.toAccount}`;
      const link =
        links.get(key) ??
        {
          fromId: transaction.fromAccount,
          toId: transaction.toAccount,
          amount: 0,
          count: 0,
          flowType: transaction.transactionType.trim().toLowerCase() === "debit" ? "debit" : "credit",
          transactionIds: [],
        };
      link.amount += transaction.amount;
      link.count += 1;
      if (transaction.transactionType.trim().toLowerCase() === "debit") {
        link.flowType = "debit";
      }
      link.transactionIds.push(transaction.transactionId);
      links.set(key, link);
    }
  }

  return Array.from(links.values()).sort((a, b) => b.amount - a.amount);
}

function buildFlaggedAccounts(statements: AccountStatement[]): FlaggedAccount[] {
  const accountsById = new Map(statements.map((statement) => [statement.accountId, statement]));
  const edges = new Map<string, { from: string; to: string; amount: number; count: number; transactionIds: string[] }>();
  let latestDatasetDate = "";

  for (const statement of statements) {
    for (const transaction of statement.transactions) {
      if (transaction.date > latestDatasetDate) {
        latestDatasetDate = transaction.date;
      }

      if (!accountsById.has(transaction.fromAccount) || !accountsById.has(transaction.toAccount)) continue;

      const key = `${transaction.fromAccount}:${transaction.toAccount}`;
      const edge = edges.get(key) ?? {
        from: transaction.fromAccount,
        to: transaction.toAccount,
        amount: 0,
        count: 0,
        transactionIds: [],
      };
      edge.amount += transaction.amount;
      edge.count += 1;
      edge.transactionIds.push(transaction.transactionId);
      edges.set(key, edge);
    }
  }

  const adjacency = new Map<string, string[]>();
  for (const edge of edges.values()) {
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to]);
  }

  const issues = new Map<string, FlaggedAccount>();
  const sortedEdges = Array.from(edges.values()).sort((a, b) => b.amount - a.amount);

  for (const edge of sortedEdges) {
    const reverseKey = `${edge.to}:${edge.from}`;
    const reverse = edges.get(reverseKey);
    if (!reverse) continue;

    const key = `cycle:${canonicalCycleKey([edge.from, edge.to])}`;
    if (issues.has(key)) continue;

    const source = accountsById.get(edge.from);
    issues.set(key, {
      id: edge.from,
      name: source?.accountName ?? "Unknown Account",
      flag: "Circular Loop",
      accountIds: [edge.from, edge.to],
      transactionIds: [...edge.transactionIds, ...reverse.transactionIds],
      detail: `${edge.from} -> ${edge.to} -> ${edge.from}`,
      amount: edge.amount + reverse.amount,
    });

    if (issues.size >= MAX_FLAGGED_ACCOUNTS) break;
  }

  if (issues.size < MAX_FLAGGED_ACCOUNTS) {
    for (const edge of sortedEdges) {
      const middleAccounts = adjacency.get(edge.to) ?? [];

      for (const middleId of middleAccounts) {
        if (middleId === edge.from) continue;

        const closingEdge = edges.get(`${middleId}:${edge.from}`);
        if (!closingEdge) continue;

        const cycle = [edge.from, edge.to, middleId];
        const key = `cycle:${canonicalCycleKey(cycle)}`;
        if (issues.has(key)) continue;

        const source = accountsById.get(edge.from);
        const secondEdge = edges.get(`${edge.to}:${middleId}`);
        issues.set(key, {
          id: edge.from,
          name: source?.accountName ?? "Unknown Account",
          flag: "Circular Loop",
          accountIds: cycle,
          transactionIds: [
            ...edge.transactionIds,
            ...(secondEdge?.transactionIds ?? []),
            ...closingEdge.transactionIds,
          ],
          detail: `${cycle.join(" -> ")} -> ${edge.from}`,
          amount: edge.amount + (secondEdge?.amount ?? 0) + closingEdge.amount,
        });

        if (issues.size >= MAX_FLAGGED_ACCOUNTS) break;
      }

      if (issues.size >= MAX_FLAGGED_ACCOUNTS) break;
    }
  }

  if (issues.size < MAX_FLAGGED_ACCOUNTS) {
    for (const firstEdge of sortedEdges) {
      const secondHopIds = adjacency.get(firstEdge.to) ?? [];

      for (const secondHopId of secondHopIds) {
        if (secondHopId === firstEdge.from) continue;

        const secondEdge = edges.get(`${firstEdge.to}:${secondHopId}`);
        if (!secondEdge) continue;

        const threeAccountPath = [firstEdge.from, firstEdge.to, secondHopId];
        if (!edges.has(`${secondHopId}:${firstEdge.from}`)) {
          addPotentialLoopIssue(issues, accountsById, threeAccountPath, [firstEdge, secondEdge]);
        }

        if (issues.size >= MAX_FLAGGED_ACCOUNTS) break;

        const thirdHopIds = adjacency.get(secondHopId) ?? [];
        for (const thirdHopId of thirdHopIds) {
          if (threeAccountPath.includes(thirdHopId)) continue;

          const thirdEdge = edges.get(`${secondHopId}:${thirdHopId}`);
          if (!thirdEdge || edges.has(`${thirdHopId}:${firstEdge.from}`)) continue;

          addPotentialLoopIssue(issues, accountsById, [...threeAccountPath, thirdHopId], [
            firstEdge,
            secondEdge,
            thirdEdge,
          ]);

          if (issues.size >= MAX_FLAGGED_ACCOUNTS) break;
        }

        if (issues.size >= MAX_FLAGGED_ACCOUNTS) break;
      }

      if (issues.size >= MAX_FLAGGED_ACCOUNTS) break;
    }
  }

  for (const edge of sortedEdges) {
    if (issues.size >= MAX_FLAGGED_ACCOUNTS) break;
    if (edges.has(`${edge.to}:${edge.from}`)) continue;

    const source = accountsById.get(edge.from);
    const target = accountsById.get(edge.to);
    if (!source || !target || edge.count < 2) continue;

    const issueKey = `potential:${edge.from}:${edge.to}`;
    issues.set(issueKey, {
      id: edge.from,
      name: source.accountName,
      flag: "Potential Loop",
      accountIds: [edge.from, edge.to],
      transactionIds: edge.transactionIds,
      detail: `${edge.from} -> ${edge.to} (${edge.count} transactions)`,
      amount: edge.amount,
    });
  }

  if (latestDatasetDate) {
    const latestTime = new Date(`${latestDatasetDate}T00:00:00`).getTime();
    const dormantMs = 45 * 24 * 60 * 60 * 1000;

    for (const statement of statements) {
      const latestAccountDate = statement.transactions.reduce(
        (latest, transaction) => (transaction.date > latest ? transaction.date : latest),
        "",
      );
      if (!latestAccountDate) continue;

      const accountTime = new Date(`${latestAccountDate}T00:00:00`).getTime();
      if (latestTime - accountTime < dormantMs) continue;

      issues.set(`dormant:${statement.accountId}`, {
        id: statement.accountId,
        name: statement.accountName,
        flag: "Dormant Account",
        accountIds: [statement.accountId],
        transactionIds: statement.transactions.map((transaction) => transaction.transactionId),
        detail: `Last activity ${formatShortDate(latestAccountDate)}`,
        amount: statement.transactions.reduce((sum, transaction) => sum + transaction.amount, 0),
      });
    }
  }

  return Array.from(issues.values()).sort((a, b) => {
    const priority = { "Circular Loop": 0, "Potential Loop": 1, "Dormant Account": 2 };
    return priority[a.flag] - priority[b.flag] || b.amount - a.amount;
  });
}

function addPotentialLoopIssue(
  issues: Map<string, FlaggedAccount>,
  accountsById: Map<string, AccountStatement>,
  accountIds: string[],
  pathEdges: Array<{ amount: number; transactionIds: string[] }>,
) {
  const key = `potential-chain:${accountIds.join(">")}`;
  if (issues.has(key)) return;

  const source = accountsById.get(accountIds[0]);
  issues.set(key, {
    id: accountIds[0],
    name: source?.accountName ?? "Unknown Account",
    flag: "Potential Loop",
    accountIds,
    transactionIds: pathEdges.flatMap((edge) => edge.transactionIds),
    detail: `${accountIds.join(" -> ")} (loop may form)`,
    amount: pathEdges.reduce((sum, edge) => sum + edge.amount, 0),
  });
}

function canonicalCycleKey(cycle: string[]) {
  return cycle
    .map((_, index) => [...cycle.slice(index), ...cycle.slice(0, index)].join(">"))
    .sort()[0];
}

function distributeInRange(count: number, start: number, end: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [(start + end) / 2];
  const step = (end - start) / (count - 1);
  return Array.from({ length: count }, (_, index) => start + step * index);
}

function distributeAround(anchorY: number, count: number, itemHeight: number, gap: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [anchorY - itemHeight / 2];

  const step = itemHeight + gap;
  const firstY = anchorY - ((count - 1) * step) / 2 - itemHeight / 2;
  return Array.from({ length: count }, (_, index) => firstY + index * step);
}

function formatAmount(amount: number): string {
  return `INR ${Math.round(amount).toLocaleString("en-IN")}`;
}

function formatCompactAmount(amount: number): string {
  if (amount >= 10000000) return `INR ${(amount / 10000000).toFixed(1)} Cr`;
  if (amount >= 100000) return `INR ${(amount / 100000).toFixed(1)} L`;
  return formatAmount(amount);
}

function formatShortDate(date: string): string {
  if (!date) return "";

  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(
    new Date(`${date}T00:00:00`),
  );
}

function getSvgPoint(event: PointerEvent<SVGElement>) {
  const svg = event.currentTarget.ownerSVGElement ?? (event.currentTarget as SVGSVGElement);
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const screenMatrix = svg.getScreenCTM();
  return screenMatrix ? point.matrixTransform(screenMatrix.inverse()) : point;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function matchesTransactionSearch(transaction: Transaction, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;

  return transaction.transactionId.toLowerCase().includes(normalizedQuery);
}

function filterStatementsByTransactionId(statements: AccountStatement[], query: string): AccountStatement[] {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return statements;

  return statements.map((statement) => ({
    ...statement,
    transactions: statement.transactions.filter((transaction) =>
      matchesTransactionSearch(transaction, normalizedQuery),
    ),
  }));
}

function filterStatementsByExactTransactionIds(
  statements: AccountStatement[],
  transactionIds: Set<string> | null,
): AccountStatement[] {
  if (!transactionIds) return statements;

  return statements.map((statement) => ({
    ...statement,
    transactions: statement.transactions.filter((transaction) => transactionIds.has(transaction.transactionId)),
  }));
}

function formatFlowAccounts(detail: FlowDetail) {
  return `${detail.from} -> ${detail.to}`;
}

function transactionTypeClass(transactionType: string) {
  const normalizedType = transactionType.trim().toLowerCase();
  if (normalizedType === "credit") return "font-semibold text-gov-green";
  if (normalizedType === "debit") return "font-semibold text-gov-red";
  return "";
}

function RiskFlagBadge({ flag }: { flag: FlaggedAccount["flag"] }) {
  return (
    <span
      className={`inline-flex px-2 py-1 text-xs font-semibold ${
        flag === "Dormant Account"
          ? "bg-muted text-muted-foreground"
          : flag === "Circular Loop"
            ? "bg-gov-red/10 text-gov-red"
            : "bg-saffron/10 text-saffron"
      }`}
    >
      {flag}
    </span>
  );
}

function zoomViewBox(viewBox: ViewBoxState, factor: number): ViewBoxState {
  const nextWidth = clamp(viewBox.width * factor, GRAPH_WIDTH * 0.35, GRAPH_WIDTH * 2.5);
  const nextHeight = clamp(viewBox.height * factor, GRAPH_HEIGHT * 0.35, GRAPH_HEIGHT * 2.5);
  const centerX = viewBox.x + viewBox.width / 2;
  const centerY = viewBox.y + viewBox.height / 2;

  return {
    x: centerX - nextWidth / 2,
    y: centerY - nextHeight / 2,
    width: nextWidth,
    height: nextHeight,
  };
}

function AccountStatementContent({ statement }: { statement?: AccountStatement }) {
  if (!statement) {
    return (
      <div className="flex h-full items-center justify-center bg-card text-sm text-muted-foreground">
        Select an account statement CSV to view its contents.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div>
          <h2 className="text-lg font-semibold">Account Statement CSV</h2>
          <p className="text-sm text-muted-foreground">
            {statement.name} - {statement.accountId} - {statement.transactions.length.toLocaleString("en-IN")} transactions
          </p>
        </div>
        <div className="border border-border bg-background px-3 py-2 text-sm font-medium">
          {statement.accountName}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full min-w-[1120px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-muted text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="border-b border-border px-4 py-3 font-semibold">Transaction ID</th>
              <th className="border-b border-border px-4 py-3 font-semibold">Type</th>
              <th className="border-b border-border px-4 py-3 font-semibold">Mode</th>
              <th className="border-b border-border px-4 py-3 font-semibold">From</th>
              <th className="border-b border-border px-4 py-3 font-semibold">To</th>
              <th className="border-b border-border px-4 py-3 text-right font-semibold">Amount</th>
              <th className="border-b border-border px-4 py-3 font-semibold">Date</th>
              <th className="border-b border-border px-4 py-3 font-semibold">Time</th>
              <th className="border-b border-border px-4 py-3 text-right font-semibold">Balance</th>
            </tr>
          </thead>
          <tbody>
            {statement.transactions.map((transaction, index) => (
              <tr key={`${transaction.transactionId}-${index}`} className="hover:bg-muted/50">
                <td className="border-b border-border px-4 py-3 font-mono text-xs">{transaction.transactionId}</td>
                <td className={`border-b border-border px-4 py-3 ${transactionTypeClass(transaction.transactionType)}`}>
                  {transaction.transactionType || "-"}
                </td>
                <td className="border-b border-border px-4 py-3">{transaction.mode || "-"}</td>
                <td className="border-b border-border px-4 py-3">
                  <div className="font-medium">{transaction.fromAccount || "-"}</div>
                  <div className="text-xs text-muted-foreground">{transaction.fromName || "-"}</div>
                </td>
                <td className="border-b border-border px-4 py-3">
                  <div className="font-medium">{transaction.toAccount || "-"}</div>
                  <div className="text-xs text-muted-foreground">{transaction.toName || "-"}</div>
                </td>
                <td className={`border-b border-border px-4 py-3 text-right font-semibold tabular-nums ${transactionTypeClass(transaction.transactionType)}`}>
                  {formatAmount(transaction.amount)}
                </td>
                <td className="border-b border-border px-4 py-3">{transaction.date || "-"}</td>
                <td className="border-b border-border px-4 py-3">{transaction.time || "-"}</td>
                <td className="border-b border-border px-4 py-3 text-right tabular-nums">
                  {formatAmount(transaction.savingsBalance)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AlertsContent({
  issues,
  selectedIssue,
  onIssueClick,
}: {
  issues: FlaggedAccount[] | null;
  selectedIssue: FlaggedAccount | null;
  onIssueClick: (issue: FlaggedAccount) => void;
}) {
  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div>
          <h2 className="text-lg font-semibold">Alerts</h2>
          <p className="text-sm text-muted-foreground">Circular loops, potential loops, and dormant account flags</p>
        </div>
        <div className="border border-border bg-background px-3 py-2 text-sm font-medium">
          {issues === null ? "Scanning..." : `${issues.length.toLocaleString("en-IN")} flags`}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(440px,0.95fr)_minmax(420px,1.05fr)]">
        <div className="min-h-0 overflow-auto border-r border-border">
          {issues === null ? (
            <div className="px-5 py-4 text-sm text-muted-foreground">Preparing alerts...</div>
          ) : issues.length === 0 ? (
            <div className="px-5 py-4 text-sm text-muted-foreground">No alerts detected.</div>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-muted text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="border-b border-border px-4 py-3 font-semibold">Account Number</th>
                  <th className="border-b border-border px-4 py-3 font-semibold">Account Holder</th>
                  <th className="border-b border-border px-4 py-3 font-semibold">Flagged</th>
                </tr>
              </thead>
              <tbody>
                {issues.map((issue) => (
                  <tr
                    key={`${issue.flag}-${issue.detail}`}
                    className={`cursor-pointer hover:bg-muted ${selectedIssue?.detail === issue.detail ? "bg-muted" : ""}`}
                    onClick={() => onIssueClick(issue)}
                  >
                    <td className="border-b border-border px-4 py-3 font-medium tabular-nums">{issue.id}</td>
                    <td className="border-b border-border px-4 py-3">
                      <div className="font-medium">{issue.name}</div>
                      <div className="max-w-[260px] truncate text-xs text-muted-foreground">{issue.detail}</div>
                    </td>
                    <td className="border-b border-border px-4 py-3">
                      <RiskFlagBadge flag={issue.flag} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="min-h-0 overflow-auto">
          {selectedIssue ? (
            <div className="p-5">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold">{selectedIssue.id}</h3>
                  <p className="text-sm text-muted-foreground">{selectedIssue.name}</p>
                  <p className="mt-1 text-sm">{selectedIssue.detail}</p>
                </div>
                <RiskFlagBadge flag={selectedIssue.flag} />
              </div>
              <div className="mb-3 flex items-center justify-between border border-border bg-background px-3 py-2 text-sm">
                <span className="font-medium">Flagged Transactions</span>
                <span className="tabular-nums text-muted-foreground">
                  {selectedIssue.transactionIds.length.toLocaleString("en-IN")} IDs
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {selectedIssue.transactionIds.map((transactionId) => (
                  <div key={transactionId} className="border border-border bg-background px-3 py-2 font-mono">
                    {transactionId}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center px-5 text-sm text-muted-foreground">
              Select an alert to view transaction IDs and filter the money flow visualization.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Dashboard() {
  const accountStatements = Route.useLoaderData();
  const graphPanelRef = useRef<HTMLDivElement | null>(null);
  const [activeView, setActiveView] = useState<AppView>("Dashboard");
  const [previewStatementName, setPreviewStatementName] = useState(accountStatements[0]?.name ?? "");
  const [selectedFileNames, setSelectedFileNames] = useState(
    () => new Set(accountStatements.slice(0, 2).map((statement) => statement.name)),
  );
  const [accountSearch, setAccountSearch] = useState("");
  const [transactionSearch, setTransactionSearch] = useState("");
  const [selectedFlow, setSelectedFlow] = useState<FlowDetail | null>(null);
  const [flagPanelOpen, setFlagPanelOpen] = useState(false);
  const [flaggedAccounts, setFlaggedAccounts] = useState<FlaggedAccount[] | null>(null);
  const [selectedFlag, setSelectedFlag] = useState<FlaggedAccount | null>(null);
  const [flagFilterActive, setFlagFilterActive] = useState(false);
  const accountStatementFiles = useMemo(
    () =>
      accountStatements.map((statement) => ({
        ...statement,
        checked: selectedFileNames.has(statement.name),
      })),
    [accountStatements, selectedFileNames],
  );
  const visibleAccountStatementFiles = useMemo(() => accountStatementFiles.filter((statement) => {
    const query = accountSearch.trim().toLowerCase();
    if (!query) return true;

    return (
      statement.name.toLowerCase().includes(query) ||
      statement.accountId.toLowerCase().includes(query) ||
      statement.accountName.toLowerCase().includes(query)
    );
  }), [accountSearch, accountStatementFiles]);
  const selectedStatements = useMemo(
    () => accountStatementFiles.filter((statement) => statement.checked),
    [accountStatementFiles],
  );
  const previewStatement =
    accountStatementFiles.find((statement) => statement.name === previewStatementName) ??
    visibleAccountStatementFiles[0] ??
    accountStatementFiles[0];
  const selectedFlagTransactionIds = useMemo(
    () => (selectedFlag ? new Set(selectedFlag.transactionIds) : null),
    [selectedFlag],
  );
  const graphStatements = useMemo(() => {
    const flaggedStatements = filterStatementsByExactTransactionIds(
      selectedStatements,
      flagFilterActive ? selectedFlagTransactionIds : null,
    );
    return filterStatementsByTransactionId(flaggedStatements, transactionSearch);
  }, [flagFilterActive, selectedStatements, selectedFlagTransactionIds, transactionSearch]);
  const selectedFileCount = accountStatementFiles.filter((file) => file.checked).length;
  const graph = useMemo(
    () => buildMoneyFlowGraph(graphStatements, { spacious: flagFilterActive }),
    [flagFilterActive, graphStatements],
  );
  const [manualNodePositions, setManualNodePositions] = useState<Record<string, { x: number; y: number }>>({});
  const [activeDrag, setActiveDrag] = useState<DragState | null>(null);
  const [activeCanvasDrag, setActiveCanvasDrag] = useState<CanvasDragState | null>(null);
  const [viewBox, setViewBox] = useState<ViewBoxState>(INITIAL_VIEW_BOX);
  const [isCanvasLocked, setIsCanvasLocked] = useState(false);
  const graphNodes = graph.nodes.map((node) => ({
    ...node,
    ...(manualNodePositions[graphNodeKey(node)] ?? {}),
  }));
  const centerCards = graph.centerCards.map((card) => ({
    ...card,
    ...(manualNodePositions[centerCardKey(card.id)] ?? {}),
  }));
  const centerLinks = buildCenterLinks(centerCards, graphStatements);
  const [overviewOpen, setOverviewOpen] = useState(false);

  function ensureFlaggedAccounts() {
    if (flaggedAccounts !== null) return flaggedAccounts;

    const nextFlaggedAccounts = buildFlaggedAccounts(accountStatements);
    setFlaggedAccounts(nextFlaggedAccounts);
    return nextFlaggedAccounts;
  }

  function displayFlaggedAccount(issue: FlaggedAccount, nextView: AppView = "Dashboard") {
    const fileNames = accountStatementFiles
      .filter((statement) => issue.accountIds.includes(statement.accountId))
      .map((statement) => statement.name);

    setSelectedFileNames(new Set(fileNames));
    setSelectedFlag(issue);
    setFlagFilterActive(true);
    setActiveView(nextView);
    setTransactionSearch("");
    setSelectedFlow(null);
    setManualNodePositions({});
    setViewBox(INITIAL_VIEW_BOX);
    setFlagPanelOpen(false);
  }

  function resetGraphView() {
    setTransactionSearch("");
    setSelectedFlag(null);
    setFlagFilterActive(false);
    setSelectedFlow(null);
    setManualNodePositions({});
    setViewBox(INITIAL_VIEW_BOX);
    setFlagPanelOpen(false);
  }

  function toggleGraphFullscreen() {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }

    void graphPanelRef.current?.requestFullscreen();
  }

  function beginNodeDrag(
    event: PointerEvent<SVGGElement>,
    key: string,
    position: { x: number; y: number },
    size = { width: NODE_WIDTH, height: NODE_HEIGHT },
  ) {
    event.preventDefault();
    event.stopPropagation();
    const point = getSvgPoint(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    setActiveDrag({
      id: key,
      offsetX: point.x - position.x,
      offsetY: point.y - position.y,
      ...size,
    });
  }

  function beginCanvasDrag(event: PointerEvent<SVGRectElement>) {
    if (isCanvasLocked) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setActiveCanvasDrag({
      clientX: event.clientX,
      clientY: event.clientY,
      viewBox,
    });
  }

  function dragNode(event: PointerEvent<SVGSVGElement>) {
    if (activeCanvasDrag) {
      const svg = event.currentTarget;
      const rect = svg.getBoundingClientRect();
      const deltaX = ((event.clientX - activeCanvasDrag.clientX) * activeCanvasDrag.viewBox.width) / rect.width;
      const deltaY = ((event.clientY - activeCanvasDrag.clientY) * activeCanvasDrag.viewBox.height) / rect.height;
      setViewBox({
        ...activeCanvasDrag.viewBox,
        x: activeCanvasDrag.viewBox.x - deltaX,
        y: activeCanvasDrag.viewBox.y - deltaY,
      });
      return;
    }

    if (!activeDrag) return;

    const point = getSvgPoint(event);
    setManualNodePositions((current) => ({
      ...current,
      [activeDrag.id]: {
        x: clamp(point.x - activeDrag.offsetX, 0, GRAPH_WIDTH - activeDrag.width),
        y: clamp(point.y - activeDrag.offsetY, 0, GRAPH_HEIGHT - activeDrag.height),
      },
    }));
  }

  function endNodeDrag() {
    setActiveDrag(null);
    setActiveCanvasDrag(null);
  }
  return (
    <div className="flex h-screen w-full flex-col bg-background font-sans text-sm text-foreground">
      {/* TOP HEADER */}
      <header className="flex items-center justify-between border-b border-border bg-card px-6 py-2.5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center border border-border bg-navy text-navy-foreground">
            <Shield className="h-6 w-6" strokeWidth={1.5} />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold uppercase tracking-wider text-saffron">Government of India</div>
            <div className="text-lg font-bold text-navy">Financial Intelligence Unit</div>
          </div>
          <div className="mx-5 h-9 w-px bg-border" />
          <div className="leading-tight">
            <h1 className="text-lg font-semibold text-foreground">Transaction Flow Analysis</h1>
            <p className="text-sm text-muted-foreground">Visualize money flow between accounts and identify key transaction patterns</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button className="flex items-center gap-1.5 border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted">
            <Flag className="h-4 w-4 text-gov-red" />
            Flag / Mark Transaction
          </button>
          <button className="flex items-center gap-1.5 border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted">
            Export Report
            <ChevronDown className="h-4 w-4" />
          </button>
          <div className="mx-1 h-6 w-px bg-border" />
          <button className="flex items-center gap-2 border border-border bg-card py-1.5 pl-1.5 pr-3 text-sm font-medium hover:bg-muted">
            <div className="flex h-7 w-7 items-center justify-center bg-navy text-xs font-semibold text-navy-foreground">AN</div>
            <span>Analyst</span>
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* FILTER BAR */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-6 py-3 text-sm">
        <div className="flex items-center gap-2 border border-border bg-card px-3 py-2 font-medium">
          <FileText className="h-4 w-4 text-gov-blue" />
          {selectedFileCount} files selected
        </div>
        <div className="flex items-center gap-2 border border-border bg-card px-3 py-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input className="w-44 bg-transparent text-sm outline-none placeholder:text-muted-foreground" placeholder="Search Account ID" />
        </div>
        <div className="flex items-center gap-1.5 border border-border bg-card px-3 py-2">
          <span className="text-muted-foreground">Amount ₹</span>
          <input className="w-20 bg-transparent text-sm outline-none placeholder:text-muted-foreground" placeholder="Min" />
          <span className="text-muted-foreground">–</span>
          <input className="w-20 bg-transparent text-sm outline-none placeholder:text-muted-foreground" placeholder="Max" />
        </div>
        <button className="flex items-center gap-2 border border-border bg-card px-3 py-2">
          Transaction Type <ChevronDown className="h-4 w-4" />
        </button>
        <label className="flex cursor-pointer items-center gap-2 border border-border bg-card px-3 py-2">
          <input type="checkbox" className="h-4 w-4 accent-[var(--navy)]" />
          Flagged / Suspicious Only
        </label>
        <div className="flex items-center gap-2 border border-border bg-card px-3 py-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">01 Jan ’24 → 30 Apr ’24</span>
        </div>

        <div className="flex items-center gap-2 border border-border bg-card px-3 py-1.5">
          <span className="text-muted-foreground">Time:</span>
          <div className="flex items-center gap-1">
            {["Jan ’24", "Feb ’24", "Mar ’24", "Apr ’24"].map((m, i) => (
              <div key={m} className="flex flex-col items-center">
                <div className={`h-1.5 w-10 ${i < 2 ? "bg-navy" : "bg-border"}`} />
                <span className="mt-1 text-xs text-muted-foreground">{m}</span>
              </div>
            ))}
          </div>
        </div>

        <button className="ml-auto flex items-center gap-2 border border-border bg-card px-3 py-2">
          <Filter className="h-4 w-4" />
          More Filters <ChevronDown className="h-4 w-4" />
        </button>
      </div>

      {/* BODY */}
      <div className="flex flex-1 overflow-hidden">
        {/* Icon nav */}
        <nav className="flex w-14 flex-col items-center gap-1 border-r border-sidebar-border bg-sidebar py-3">
          {navItems.map(({ icon: Icon, label }) => {
            const active = activeView === label;
            return (
              <button
                key={label}
                title={label}
                onClick={() => {
                  if (label !== "Dashboard" && label !== "Account Statements" && label !== "Alerts") return;
                  if (label === "Alerts") {
                    const issues = ensureFlaggedAccounts();
                    setSelectedFlag((current) => current ?? issues[0] ?? null);
                  }
                  if (label === "Dashboard") {
                    setSelectedFlag(null);
                    setFlagFilterActive(false);
                    setTransactionSearch("");
                    setSelectedFlow(null);
                  }
                  setActiveView(label);
                  if (label === "Account Statements" && !previewStatementName) {
                    setPreviewStatementName(previewStatement?.name ?? "");
                  }
                }}
                className={`flex h-11 w-11 items-center justify-center border-l-2 ${
                  active
                    ? "border-saffron bg-sidebar-accent text-sidebar-primary-foreground"
                    : "border-transparent text-sidebar-foreground hover:bg-sidebar-accent/50"
                }`}
              >
                <Icon className="h-5 w-5" strokeWidth={1.7} />
              </button>
            );
          })}
          <div className="mt-auto">
            <button title="Collapse" className="flex h-11 w-11 items-center justify-center text-sidebar-foreground hover:bg-sidebar-accent/50">
              <PanelLeftClose className="h-5 w-5" strokeWidth={1.7} />
            </button>
          </div>
        </nav>

        {/* Account statements panel */}
        <aside className="flex w-72 flex-col border-r border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Account Statements CSV</h2>
          </div>
          <div className="border-b border-border p-3">
            <div className="flex items-center gap-2 border border-border bg-background px-3 py-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                value={accountSearch}
                onChange={(event) => setAccountSearch(event.target.value)}
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                placeholder="Search statements"
              />
            </div>
          </div>
          <ul className="flex-1 overflow-y-auto py-1 text-sm">
            {visibleAccountStatementFiles.map((f) => (
              <li key={f.name}>
                <label
                  className={`flex min-h-10 cursor-pointer items-center gap-2 px-4 py-2 hover:bg-muted ${
                    previewStatementName === f.name && activeView === "Account Statements" ? "bg-muted" : ""
                  }`}
                  title="Double-click to view CSV contents"
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    setPreviewStatementName(f.name);
                    setActiveView("Account Statements");
                  }}
                >
                  <input
                    type="checkbox"
                    checked={f.checked}
                    onChange={() => {
                      setPreviewStatementName(f.name);
                      setSelectedFileNames((current) => {
                        const next = new Set(current);
                        if (next.has(f.name)) {
                          next.delete(f.name);
                        } else {
                          next.add(f.name);
                        }
                        return next;
                      });
                    }}
                    className="h-4 w-4 accent-[var(--navy)]"
                  />
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className={f.checked ? "font-medium text-foreground" : "text-foreground"}>{f.name}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
            <span className="font-medium">{selectedFileCount} files selected</span>
            <button className="text-gov-blue hover:underline" onClick={() => setSelectedFileNames(new Set())}>
              Clear selection
            </button>
          </div>
        </aside>

        {/* MAIN */}
        <main className="flex-1 overflow-hidden p-0">
          {activeView === "Account Statements" ? (
            <AccountStatementContent statement={previewStatement} />
          ) : activeView === "Alerts" ? (
            <AlertsContent
              issues={flaggedAccounts}
              selectedIssue={selectedFlag}
              onIssueClick={(issue) => {
                displayFlaggedAccount(issue);
              }}
            />
          ) : (
          <div ref={graphPanelRef} className="relative flex h-full flex-col bg-card">
            {/* Card header */}
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <div>
                <h2 className="text-lg font-semibold">Money Flow Visualization</h2>
                <p className="text-sm text-muted-foreground">
                  Account-to-account relationships across {selectedFileCount} selected files
                </p>
                {selectedFlag && flagFilterActive && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                    <RiskFlagBadge flag={selectedFlag.flag} />
                    <span className="text-muted-foreground">
                      Showing {selectedFlag.transactionIds.length.toLocaleString("en-IN")} flagged transactions: {selectedFlag.detail}
                    </span>
                    <button className="text-gov-blue hover:underline" onClick={resetGraphView}>
                      Clear flag filter
                    </button>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3">
                <div className="relative flex items-center gap-2">
                  <div className="flex min-h-10 items-center gap-2 border border-border bg-background px-3 py-2">
                    <Search className="h-4 w-4 text-muted-foreground" />
                    <input
                      value={transactionSearch}
                      onChange={(event) => {
                        setTransactionSearch(event.target.value);
                        setSelectedFlow(null);
                      }}
                      className="w-48 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                      placeholder="Search transaction ID"
                    />
                  </div>
                  <button
                    className="flex min-h-10 items-center gap-2 border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-muted"
                    onClick={() => {
                      if (!flagPanelOpen) ensureFlaggedAccounts();
                      setFlagPanelOpen((current) => !current);
                    }}
                  >
                    <Flag className="h-4 w-4 text-gov-red" />
                    Risk Flags
                    <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs tabular-nums">
                      {flaggedAccounts === null ? "Scan" : flaggedAccounts.length.toLocaleString("en-IN")}
                    </span>
                  </button>
                  {flagPanelOpen && (
                    <div className="absolute right-0 top-12 z-30 w-[520px] border border-border bg-card shadow-lg">
                      <div className="flex items-center justify-between border-b border-border bg-muted px-3 py-2">
                        <span className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                          Circular Loops / Dormant Flags
                        </span>
                        <button className="text-sm text-gov-blue hover:underline" onClick={() => setFlagPanelOpen(false)}>
                          Close
                        </button>
                      </div>
                      <div className="max-h-80 overflow-y-auto">
                        {flaggedAccounts === null ? (
                          <div className="px-3 py-4 text-sm text-muted-foreground">
                            Click Risk Flags to scan account loops and dormant accounts.
                          </div>
                        ) : flaggedAccounts.length === 0 ? (
                          <div className="px-3 py-4 text-sm text-muted-foreground">
                            No circular loops or dormant accounts detected.
                          </div>
                        ) : (
                          <table className="w-full border-collapse text-sm">
                            <thead className="sticky top-0 bg-card text-left text-xs uppercase tracking-wider text-muted-foreground">
                              <tr>
                                <th className="border-b border-border px-3 py-2 font-semibold">Account Number</th>
                                <th className="border-b border-border px-3 py-2 font-semibold">Account Holder</th>
                                <th className="border-b border-border px-3 py-2 font-semibold">Flagged</th>
                              </tr>
                            </thead>
                            <tbody>
                              {flaggedAccounts.map((issue) => (
                                <tr
                                  key={`${issue.flag}-${issue.detail}`}
                                  className="cursor-pointer hover:bg-muted"
                                  onClick={() => displayFlaggedAccount(issue)}
                                >
                                  <td className="border-b border-border px-3 py-2 font-medium tabular-nums">{issue.id}</td>
                                  <td className="border-b border-border px-3 py-2">
                                    <div className="font-medium">{issue.name}</div>
                                    <div className="max-w-[220px] truncate text-xs text-muted-foreground">{issue.detail}</div>
                                    <div className="text-xs text-muted-foreground">
                                      {issue.transactionIds.length.toLocaleString("en-IN")} transaction IDs
                                    </div>
                                  </td>
                                  <td className="border-b border-border px-3 py-2">
                                    <RiskFlagBadge flag={issue.flag} />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 bg-gov-green" />Incoming</span>
                  <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 bg-gov-red" />Outgoing</span>
                  <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 border border-dashed border-gov-gray" />Internal Transfer</span>
                </div>
                <div className="flex items-center border border-border">
                  <button title="Refresh" className="border-r border-border p-2 hover:bg-muted" onClick={resetGraphView}>
                    <RefreshCw className="h-4 w-4" />
                  </button>
                  <button title="Fullscreen" className="p-2 hover:bg-muted" onClick={toggleGraphFullscreen}>
                    <Expand className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Graph */}
            <div
              className="relative flex-1 overflow-hidden"
              style={{
                backgroundColor: "var(--muted)",
                backgroundImage:
                  "radial-gradient(circle, var(--border) 1px, transparent 1px), radial-gradient(circle, color-mix(in oklch, var(--border) 60%, transparent) 1px, transparent 1px)",
                backgroundSize: "20px 20px, 80px 80px",
                backgroundPosition: "0 0, 10px 10px",
              }}
            >
              {/* Zoom controls */}
              <div className="absolute bottom-4 right-4 z-20 flex border border-border bg-card shadow-sm">
                <button
                  className="border-r border-border p-2 hover:bg-muted"
                  title="Zoom in"
                  onClick={() => setViewBox((current) => zoomViewBox(current, 0.82))}
                >
                  <Plus className="h-4 w-4" />
                </button>
                <button
                  className="border-r border-border p-2 hover:bg-muted"
                  title="Zoom out"
                  onClick={() => setViewBox((current) => zoomViewBox(current, 1.22))}
                >
                  <Minus className="h-4 w-4" />
                </button>
                <button
                  className="border-r border-border p-2 hover:bg-muted"
                  title="Fit"
                  onClick={() => setViewBox(INITIAL_VIEW_BOX)}
                >
                  <Maximize2 className="h-4 w-4" />
                </button>
                <button
                  className={`p-2 hover:bg-muted ${isCanvasLocked ? "bg-muted text-foreground" : ""}`}
                  title={isCanvasLocked ? "Unlock canvas" : "Lock canvas"}
                  onClick={() => setIsCanvasLocked((current) => !current)}
                >
                  <Lock className="h-4 w-4" />
                </button>
              </div>

              {/* Network overview */}
              <div className="absolute right-3 top-3 z-10 w-64 border border-border bg-card shadow-sm">
                <div className="flex items-center justify-between border-b border-border bg-muted px-3 py-2">
                  <span className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Network Overview</span>
                  <button
                    onClick={() => setOverviewOpen((v) => !v)}
                    title={overviewOpen ? "Collapse" : "Expand"}
                    className="flex h-7 w-7 items-center justify-center border border-border bg-card text-muted-foreground hover:bg-background hover:text-foreground"
                  >
                    {overviewOpen ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                  </button>
                </div>
                {overviewOpen && (
                  <>
                    <dl className="divide-y divide-border text-sm">
                      <div className="flex justify-between px-3 py-2"><dt className="text-muted-foreground">Total Transactions</dt><dd className="font-semibold tabular-nums">{graph.totalTransactions.toLocaleString("en-IN")}</dd></div>
                      <div className="flex justify-between px-3 py-2"><dt className="text-muted-foreground">Total Accounts</dt><dd className="font-semibold tabular-nums">{graph.totalAccounts.toLocaleString("en-IN")}</dd></div>
                      <div className="flex justify-between px-3 py-2"><dt className="text-muted-foreground">Total Amount</dt><dd className="font-semibold tabular-nums">{formatAmount(graph.totalAmount)}</dd></div>
                      <div className="flex justify-between px-3 py-2"><dt className="text-muted-foreground">High Value Transactions</dt><dd className="font-semibold tabular-nums text-gov-red">{graph.flaggedCount.toLocaleString("en-IN")}</dd></div>
                    </dl>
                    <div className="border-t border-border bg-muted/50 px-3 py-1.5 text-right">
                      <a className="text-sm font-medium text-gov-blue hover:underline" href="#">View Details →</a>
                    </div>
                  </>
                )}
              </div>

              <svg
                viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
                className={`block h-full min-h-[640px] w-full touch-none select-none ${isCanvasLocked ? "cursor-default" : "cursor-grab active:cursor-grabbing"}`}
                preserveAspectRatio="xMidYMid meet"
                onPointerMove={dragNode}
                onPointerUp={endNodeDrag}
                onPointerCancel={endNodeDrag}
                onPointerLeave={endNodeDrag}
              >
                <defs>
                  <marker id="arrow-in" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M0,0 L10,5 L0,10 z" fill="var(--gov-green)" />
                  </marker>
                  <marker id="arrow-out" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M0,0 L10,5 L0,10 z" fill="var(--gov-red)" />
                  </marker>
                  <marker id="arrow-credit" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M0,0 L10,5 L0,10 z" fill="var(--gov-green)" />
                  </marker>
                  <marker id="arrow-debit" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M0,0 L10,5 L0,10 z" fill="var(--gov-red)" />
                  </marker>
                  <marker id="arrow-potential" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M0,0 L10,5 L0,10 z" fill="var(--saffron)" />
                  </marker>
                  <marker id="arrow-int" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M0,0 L10,5 L0,10 z" fill="var(--gov-gray)" />
                  </marker>
                </defs>

                <rect
                  x={viewBox.x - viewBox.width}
                  y={viewBox.y - viewBox.height}
                  width={viewBox.width * 3}
                  height={viewBox.height * 3}
                  fill="transparent"
                  pointerEvents="all"
                  onPointerDown={beginCanvasDrag}
                />

                {centerLinks.map((link) => {
                  const fromCard = centerCards.find((card) => card.id === link.fromId);
                  const toCard = centerCards.find((card) => card.id === link.toId);
                  if (!fromCard || !toCard) return null;

                  const hasReverseLink = centerLinks.some(
                    (candidate) => candidate.fromId === link.toId && candidate.toId === link.fromId,
                  );
                  const reciprocalOffset = hasReverseLink ? (link.fromId < link.toId ? -18 : 18) : 0;
                  const fromIsLeft = fromCard.x + CENTER_WIDTH / 2 <= toCard.x + CENTER_WIDTH / 2;
                  const x1 = fromIsLeft ? fromCard.x + CENTER_WIDTH : fromCard.x;
                  const y1 = fromCard.y + CENTER_HEIGHT / 2 + reciprocalOffset;
                  const x2 = fromIsLeft ? toCard.x : toCard.x + CENTER_WIDTH;
                  const y2 = toCard.y + CENTER_HEIGHT / 2 + reciprocalOffset;
                  const d = curve(x1, y1, x2, y2);
                  const mx = (x1 + x2) / 2;
                  const my = (y1 + y2) / 2;
                  const isPotentialFlow = flagFilterActive && selectedFlag?.flag === "Potential Loop";
                  const linkColor = isPotentialFlow
                    ? "var(--saffron)"
                    : link.flowType === "debit"
                      ? "var(--gov-red)"
                      : "var(--gov-green)";
                  const linkMarker = isPotentialFlow
                    ? "url(#arrow-potential)"
                    : link.flowType === "debit"
                      ? "url(#arrow-debit)"
                      : "url(#arrow-credit)";

                  return (
                    <g key={`center-link-${link.fromId}-${link.toId}`}>
                      <path
                        d={d}
                        fill="none"
                        stroke={linkColor}
                        strokeWidth={2}
                        markerEnd={linkMarker}
                        className="cursor-pointer"
                        onClick={() =>
                          setSelectedFlow({
                            from: link.fromId,
                            to: link.toId,
                            amount: link.amount,
                            transactionIds: link.transactionIds,
                            x: mx,
                            y: my,
                          })
                        }
                      />
                      <rect x={mx - 48} y={my - 10} width={96} height={18} fill="var(--card)" stroke="var(--border)" />
                      <text x={mx} y={my + 3} textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--foreground)">
                        {formatCompactAmount(link.amount)}
                      </text>
                    </g>
                  );
                })}

                {/* edges */}
                {graphNodes.map((n) => {
                  const color = n.type === "in" ? "var(--gov-green)" : n.type === "out" ? "var(--gov-red)" : "var(--gov-gray)";
                  const marker = n.type === "in" ? "url(#arrow-in)" : n.type === "out" ? "url(#arrow-out)" : "url(#arrow-int)";
                  const dash = n.type === "internal" ? "6 4" : undefined;
                  const targetCard = nearestCenterCard(n, centerCards);
                  const targetX =
                    n.type === "in" ? targetCard.x : targetCard.x + CENTER_WIDTH;
                  const targetY = targetCard.y + CENTER_HEIGHT / 2;
                  const from = n.type === "in" ? n.id : targetCard.id;
                  const to = n.type === "in" ? targetCard.id : n.id;
                  const [x1, y1, x2, y2] =
                    n.type === "in"
                      ? [n.x + NODE_WIDTH, n.y + NODE_HEIGHT / 2, targetX, targetY]
                      : [targetX, targetY, n.x, n.y + NODE_HEIGHT / 2];
                  const d = curve(x1, y1, x2, y2);
                  const mx = (x1 + x2) / 2;
                  const my = (y1 + y2) / 2 - 22;
                  return (
                    <g key={`edge-${graphNodeKey(n)}`}>
                      <path
                        d={d}
                        fill="none"
                        stroke={color}
                        strokeWidth={1.5}
                        strokeDasharray={dash}
                        markerEnd={marker}
                        className="cursor-pointer"
                        onClick={() =>
                          setSelectedFlow({
                            from,
                            to,
                            amount: n.amount,
                            transactionIds: n.transactionIds,
                            x: mx,
                            y: my,
                          })
                        }
                      />
                      <g>
                        <rect x={mx - 46} y={my - 9} width={92} height={16} fill="var(--card)" stroke="var(--border)" />
                        <text x={mx} y={my + 2} textAnchor="middle" fontSize="10" fontWeight="600" fill="var(--foreground)">{formatCompactAmount(n.amount)}</text>
                      </g>
                    </g>
                  );
                })}

                {/* surrounding nodes */}
                {graphNodes.map((n) => (
                  <g
                    key={`node-${graphNodeKey(n)}`}
                    className="cursor-move"
                    onPointerDown={(event) => beginNodeDrag(event, graphNodeKey(n), n)}
                  >
                    <rect x={n.x} y={n.y} width={NODE_WIDTH} height={NODE_HEIGHT} fill="var(--card)" stroke="var(--border)" />
                    <rect x={n.x} y={n.y} width={4} height={NODE_HEIGHT} fill={n.type === "in" ? "var(--gov-green)" : n.type === "out" ? "var(--gov-red)" : "var(--gov-gray)"} />
                    <text x={n.x + 14} y={n.y + 21} fontSize="12" fontWeight="600" fill="var(--foreground)">{n.id}</text>
                    <text x={n.x + 14} y={n.y + 40} fontSize="11" fill="var(--muted-foreground)">
                      {n.count} txn - {n.type === "in" ? "Incoming" : n.type === "out" ? "Outgoing" : "Internal"}
                    </text>
                  </g>
                ))}

                {/* selected account cards */}
                {centerCards.map((card) => (
                  <g
                    key={card.id}
                    className="cursor-move"
                    onPointerDown={(event) =>
                      beginNodeDrag(event, centerCardKey(card.id), card, {
                        width: CENTER_WIDTH,
                        height: CENTER_HEIGHT,
                      })
                    }
                  >
                    <rect x={card.x} y={card.y} width={CENTER_WIDTH} height={CENTER_HEIGHT} fill="var(--navy)" stroke="var(--navy-deep)" strokeWidth={1.5} />
                    <rect x={card.x} y={card.y} width={CENTER_WIDTH} height={4} fill="var(--saffron)" />
                    <rect x={card.x + 14} y={card.y + 22} width="22" height="22" fill="var(--navy-deep)" />
                    <text x={card.x + 46} y={card.y + 28} fontSize="13" fontWeight="700" fill="var(--navy-foreground)">{card.id}</text>
                    <text x={card.x + 46} y={card.y + 47} fontSize="11" fill="oklch(0.85 0.02 250)">{card.count} txn - {card.name}</text>
                    <text x={card.x + 46} y={card.y + 68} fontSize="14" fontWeight="700" fill="var(--saffron)">{formatAmount(card.amount)}</text>
                  </g>
                ))}

                {centerCards.map((card) => (
                  <foreignObject key={`icon-${card.id}`} x={card.x + 14} y={card.y + 22} width="22" height="22" pointerEvents="none">
                    <div className="flex h-full w-full items-center justify-center text-navy-foreground">
                      <Building2 className="h-4 w-4" />
                    </div>
                  </foreignObject>
                ))}

                {selectedFlow && (
                  <foreignObject
                    x={clamp(selectedFlow.x + 14, viewBox.x + 12, viewBox.x + viewBox.width - 342)}
                    y={clamp(selectedFlow.y - 72, viewBox.y + 12, viewBox.y + viewBox.height - 172)}
                    width="330"
                    height="160"
                  >
                    <div className="h-full w-full border border-border bg-card p-3 text-sm shadow-sm">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <span className="font-semibold text-foreground">Transaction Flow</span>
                        <button className="text-gov-blue hover:underline" onClick={() => setSelectedFlow(null)}>
                          Close
                        </button>
                      </div>
                      <dl className="space-y-1.5">
                        <div className="flex justify-between gap-3">
                          <dt className="text-muted-foreground">Route</dt>
                          <dd className="text-right font-medium">{formatFlowAccounts(selectedFlow)}</dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt className="text-muted-foreground">Amount</dt>
                          <dd className="font-semibold">{formatAmount(selectedFlow.amount)}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Transaction ID</dt>
                          <dd className="mt-1 max-h-12 overflow-y-auto font-mono text-xs text-foreground">
                            {selectedFlow.transactionIds.slice(0, 12).join(", ")}
                            {selectedFlow.transactionIds.length > 12 ? ` +${selectedFlow.transactionIds.length - 12} more` : ""}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  </foreignObject>
                )}
              </svg>

              {/* status icons row legend small */}
              <div className="flex items-center justify-between border-t border-border bg-muted/40 px-4 py-1.5 text-sm text-muted-foreground">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1"><ArrowDownLeft className="h-4 w-4 text-gov-green" /> {graph.incomingCount.toLocaleString("en-IN")} incoming</span>
                  <span className="flex items-center gap-1"><ArrowUpRight className="h-4 w-4 text-gov-red" /> {graph.outgoingCount.toLocaleString("en-IN")} outgoing</span>
                  <span className="flex items-center gap-1"><ArrowLeftRight className="h-4 w-4 text-gov-gray" /> {graph.internalCount.toLocaleString("en-IN")} internal</span>
                </div>
                <span>{graph.dateRange}</span>
              </div>
            </div>
          </div>
          )}
        </main>
      </div>

      {/* FOOTER */}
      <footer className="flex items-center justify-between border-t border-border bg-card px-6 py-2 text-sm text-muted-foreground">
        <p>This system is intended for authorized use only. Unauthorized access is prohibited and may be subject to legal action.</p>
        <p>© 2024 Financial Intelligence Unit, Government of India</p>
      </footer>
    </div>
  );
}
