import type { Node } from "web-tree-sitter";
import type { CodeUnit } from "../types.ts";
import { codeUnitFromNode, ensureUniqueCodeUnitIds } from "./tree-sitter-unit-extractor.ts";

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

    units.push(
      codeUnitFromNode(
        node,
        filePath,
        language,
        valueNode.type === "arrow_function" ? "arrow_function" : "function_expression",
        nameNode?.text ?? null,
      ),
    );
  }

  return units;
};

const extractClassMembers = (classNode: Node, filePath: string, language: string): CodeUnit[] => {
  const units: CodeUnit[] = [];
  const body = classNode.childForFieldName("body");
  if (!body) return units;

  for (const child of body.namedChildren) {
    if (child.type !== "method_definition") continue;

    units.push(codeUnitFromNode(child, filePath, language, "method_definition"));
  }

  return units;
};

const extractFromExportStatement = (node: Node, filePath: string, language: string): CodeUnit[] => {
  const declaration = node.childForFieldName("declaration");
  if (declaration) return extractNode(declaration, filePath, language);

  return node.namedChildren.flatMap((child) =>
    EXTRACTABLE_TOP_LEVEL.has(child.type) && child.type !== "export_statement"
      ? extractNode(child, filePath, language)
      : [],
  );
};

const extractNode = (node: Node, filePath: string, language: string): CodeUnit[] => {
  switch (node.type) {
    case "function_declaration": {
      return [codeUnitFromNode(node, filePath, language, "function_declaration")];
    }

    case "class_declaration": {
      return [
        codeUnitFromNode(node, filePath, language, "class_declaration"),
        ...extractClassMembers(node, filePath, language),
      ];
    }

    case "lexical_declaration": {
      return extractFromLexicalDeclaration(node, filePath, language);
    }

    case "export_statement": {
      return extractFromExportStatement(node, filePath, language);
    }
  }

  return [];
};

export const extractCodeUnitsFromRootNode = (
  rootNode: Node,
  filePath: string,
  language: string,
): CodeUnit[] => {
  return ensureUniqueCodeUnitIds(
    rootNode.namedChildren.flatMap((child) =>
      EXTRACTABLE_TOP_LEVEL.has(child.type) ? extractNode(child, filePath, language) : [],
    ),
  );
};
