import { createHash } from "node:crypto";
import type { Node } from "web-tree-sitter";
import { type CodeUnit, makeUnitId } from "../types.ts";

export interface UnitExtractionRule {
  readonly nodeType: string;
  readonly unitType: string | ((node: Node) => string);
  readonly getName?: (node: Node) => string | null;
  readonly shouldExtract?: (node: Node) => boolean;
  readonly descendIntoChildren?: boolean;
}

const firstNamedChildOfType = (node: Node, types: ReadonlySet<string>): Node | null => {
  for (const child of node.namedChildren) {
    if (types.has(child.type)) return child;
  }

  return null;
};

const firstDescendantOfType = (node: Node, types: ReadonlySet<string>): Node | null => {
  const direct = firstNamedChildOfType(node, types);
  if (direct) return direct;

  for (const child of node.namedChildren) {
    const descendant = firstDescendantOfType(child, types);
    if (descendant) return descendant;
  }

  return null;
};

export const nameFromField = (node: Node): string | null => {
  return node.childForFieldName("name")?.text ?? null;
};

export const nameFromFirstChild = (...nodeTypes: string[]) => {
  const types = new Set(nodeTypes);
  return (node: Node): string | null => firstNamedChildOfType(node, types)?.text ?? null;
};

export const nameFromFirstDescendant = (...nodeTypes: string[]) => {
  const types = new Set(nodeTypes);
  return (node: Node): string | null => firstDescendantOfType(node, types)?.text ?? null;
};

export const nameFromDeclarator = (node: Node): string | null => {
  const declarator = node.childForFieldName("declarator") ?? node;
  return (
    firstDescendantOfType(
      declarator,
      new Set(["identifier", "field_identifier", "type_identifier"]),
    )?.text ?? null
  );
};

export const hasChildOfType = (nodeType: string) => {
  return (node: Node): boolean => firstNamedChildOfType(node, new Set([nodeType])) !== null;
};

const makeDisambiguatedUnitId = (unit: CodeUnit, occurrence: number): string => {
  const hash = createHash("sha256");
  hash.update(
    [
      unit.id,
      unit.filePath,
      String(unit.startLine),
      String(unit.endLine),
      unit.unitType,
      unit.name ?? "",
      unit.source,
      String(occurrence),
    ].join("\0"),
  );
  return hash.digest("hex").slice(0, 16);
};

export const ensureUniqueCodeUnitIds = (units: CodeUnit[]): CodeUnit[] => {
  const counts = new Map<string, number>();
  for (const unit of units) {
    counts.set(unit.id, (counts.get(unit.id) ?? 0) + 1);
  }

  const occurrences = new Map<string, number>();
  return units.map((unit) => {
    if ((counts.get(unit.id) ?? 0) <= 1) return unit;

    const occurrence = occurrences.get(unit.id) ?? 0;
    occurrences.set(unit.id, occurrence + 1);
    return { ...unit, id: makeDisambiguatedUnitId(unit, occurrence) };
  });
};

const toCodeUnit = (
  node: Node,
  filePath: string,
  language: string,
  rule: UnitExtractionRule,
): CodeUnit => {
  const startLine = node.startPosition.row + 1;
  const endLine = node.endPosition.row + 1;
  const unitType = typeof rule.unitType === "function" ? rule.unitType(node) : rule.unitType;

  return {
    id: makeUnitId(filePath, startLine, endLine),
    filePath,
    startLine,
    endLine,
    unitType,
    name: rule.getName?.(node) ?? nameFromField(node),
    source: node.text,
    language,
  };
};

export const extractCodeUnitsByRules = (
  rootNode: Node,
  filePath: string,
  language: string,
  rules: readonly UnitExtractionRule[],
): CodeUnit[] => {
  const units: CodeUnit[] = [];

  const visit = (node: Node): void => {
    const rule = rules.find(
      (candidate) =>
        candidate.nodeType === node.type &&
        (candidate.shouldExtract === undefined || candidate.shouldExtract(node)),
    );

    if (rule) {
      units.push(toCodeUnit(node, filePath, language, rule));
      if (!rule.descendIntoChildren) return;
    }

    for (const child of node.namedChildren) {
      visit(child);
    }
  };

  visit(rootNode);
  return ensureUniqueCodeUnitIds(units);
};
