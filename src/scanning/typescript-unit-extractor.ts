import type { Node } from "web-tree-sitter";
import { type CodeUnit, makeUnitId } from "../types.ts";

const EXTRACTABLE_TOP_LEVEL = new Set([
  "function_declaration",
  "class_declaration",
  "lexical_declaration",
  "export_statement",
]);

const isFunctionLike = (node: Node): boolean => {
  return (
    node.type === "arrow_function" ||
    node.type === "function" ||
    node.type === "function_expression"
  );
};

const extractFromLexicalDeclaration = (
  node: Node,
  filePath: string,
  language: string,
): CodeUnit[] => {
  const units: CodeUnit[] = [];

  for (const declarator of node.namedChildren) {
    if (declarator.type !== "variable_declarator") continue;

    const nameNode = declarator.childForFieldName("name");
    const valueNode = declarator.childForFieldName("value");
    if (!valueNode || !isFunctionLike(valueNode)) continue;

    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;

    units.push({
      id: makeUnitId(filePath, startLine, endLine),
      filePath,
      startLine,
      endLine,
      unitType: valueNode.type === "arrow_function" ? "arrow_function" : "function_expression",
      name: nameNode?.text ?? null,
      source: node.text,
      language,
    });
  }

  return units;
};

const extractClassMembers = (classNode: Node, filePath: string, language: string): CodeUnit[] => {
  const units: CodeUnit[] = [];
  const body = classNode.childForFieldName("body");
  if (!body) return units;

  for (const child of body.namedChildren) {
    if (child.type !== "method_definition") continue;

    const nameNode = child.childForFieldName("name");
    const startLine = child.startPosition.row + 1;
    const endLine = child.endPosition.row + 1;

    units.push({
      id: makeUnitId(filePath, startLine, endLine),
      filePath,
      startLine,
      endLine,
      unitType: "method_definition",
      name: nameNode?.text ?? null,
      source: child.text,
      language,
    });
  }

  return units;
};

const extractNode = (node: Node, filePath: string, language: string): CodeUnit[] => {
  const units: CodeUnit[] = [];

  switch (node.type) {
    case "function_declaration": {
      const nameNode = node.childForFieldName("name");
      const startLine = node.startPosition.row + 1;
      const endLine = node.endPosition.row + 1;

      units.push({
        id: makeUnitId(filePath, startLine, endLine),
        filePath,
        startLine,
        endLine,
        unitType: "function_declaration",
        name: nameNode?.text ?? null,
        source: node.text,
        language,
      });
      break;
    }

    case "class_declaration": {
      const nameNode = node.childForFieldName("name");
      const startLine = node.startPosition.row + 1;
      const endLine = node.endPosition.row + 1;

      units.push({
        id: makeUnitId(filePath, startLine, endLine),
        filePath,
        startLine,
        endLine,
        unitType: "class_declaration",
        name: nameNode?.text ?? null,
        source: node.text,
        language,
      });

      units.push(...extractClassMembers(node, filePath, language));
      break;
    }

    case "lexical_declaration": {
      units.push(...extractFromLexicalDeclaration(node, filePath, language));
      break;
    }

    case "export_statement": {
      const declaration = node.childForFieldName("declaration");
      if (declaration) {
        units.push(...extractNode(declaration, filePath, language));
      } else {
        for (const child of node.namedChildren) {
          if (EXTRACTABLE_TOP_LEVEL.has(child.type) && child.type !== "export_statement") {
            units.push(...extractNode(child, filePath, language));
          }
        }
      }
      break;
    }
  }

  return units;
};

export const extractCodeUnitsFromRootNode = (
  rootNode: Node,
  filePath: string,
  language: string,
): CodeUnit[] => {
  const units: CodeUnit[] = [];

  for (const child of rootNode.namedChildren) {
    if (EXTRACTABLE_TOP_LEVEL.has(child.type)) {
      units.push(...extractNode(child, filePath, language));
    }
  }

  return units;
};
