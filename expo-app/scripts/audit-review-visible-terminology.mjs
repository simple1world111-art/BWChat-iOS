import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const projectRoot = process.cwd();
const localeRules = {
  de: /\b(?:zahlung\p{L}*|zahlen|bezahlt|auszahlung\p{L}*)\b/iu,
  en: /\b(?:pay(?:ment|ments|ing|ed)?|paid|payouts?)\b/iu,
  es: /\b(?:pago\p{L}*|pagar\p{L}*|pagado\p{L}*|desembolso\p{L}*)\b/iu,
  fr: /\b(?:paiement\p{L}*|payer\p{L}*|payé\p{L}*|versement\p{L}*)\b/iu,
  ja: /支払|支払い|課金|決済/u,
  ko: /결제|지불|과금/u,
  "pt-BR": /\b(?:pagamento\p{L}*|pagar\p{L}*|pague\p{L}*|pago\p{L}*|desembolso\p{L}*)\b/iu,
  ru: /(?:платеж\p{L}*|платёж\p{L}*|оплат\p{L}*|заплат\p{L}*|выплат\p{L}*)/iu,
  "zh-Hans": /支付|付款|付费|打款/u,
  "zh-Hant": /支付|付款|付費|打款/u,
};
const allowedCatalogKeys = new Set([
  // StoreKit failures and the transaction source must describe the real
  // purchase outcome accurately; obscuring these terms would mislead users.
  "wallet.purchase.cancelled",
  "wallet.purchase.failed",
  "wallet.purchase.failedWithError",
  "wallet.transaction.iapSubtitle",
  // Legal and privacy copy must not conceal actual financial processing.
  "account.deletion.reason.financialCompliance",
  "account.privacyPolicy.fallback",
  "account.dataPrivacy.fallback",
  "wallet.terms.fallback",
]);
const reviewVisibleSourcePattern = new RegExp(
  [
    String.raw`\b(?:pay(?:ment|ments|ing|ed)?|paid|payouts?)\b`,
    String.raw`支付|付款|付费|付費|打款|課金|決済|支払|결제|지불|과금`,
  ].join("|"),
  "iu",
);
const nonEnglishSourcePattern = /支付|付款|付费|付費|打款|課金|決済|支払|결제|지불|과금/u;
const visibleAttributeNames = new Set([
  "accessibilityHint",
  "accessibilityLabel",
  "buttonText",
  "description",
  "emptyText",
  "errorText",
  "helperText",
  "label",
  "message",
  "placeholder",
  "subtitle",
  "text",
  "title",
]);

function decodeStringsValue(value) {
  return JSON.parse(`"${value}"`);
}

function literalValue(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return null;
}

function callName(node) {
  const expression = node.expression;
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return "";
}

async function sourceFilesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceFilesBelow(absolute);
      return entry.isFile() && /\.tsx?$/u.test(entry.name) ? [absolute] : [];
    }),
  );
  return nested.flat();
}

function auditReviewVisibleSource(sourcePath, source, failures) {
  const relativePath = path.relative(projectRoot, sourcePath);
  const sourceFile = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    sourcePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const report = (node, value) => {
    if (!reviewVisibleSourcePattern.test(value)) return;
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    failures.push(`${relativePath}:${line + 1}: ${value.trim()}`);
  };

  const visit = (node) => {
    // Non-English financial euphemisms are not valid protocol identifiers in
    // this client, so scan every literal. This covers hard-coded creator UI.
    const directLiteral = literalValue(node);
    if (directLiteral !== null && nonEnglishSourcePattern.test(directLiteral)) {
      report(node, directLiteral);
    }

    if (ts.isJsxText(node)) {
      report(node, node.text);
    } else if (ts.isJsxAttribute(node) && visibleAttributeNames.has(node.name.text)) {
      if (node.initializer && ts.isStringLiteral(node.initializer)) {
        report(node.initializer, node.initializer.text);
      } else if (node.initializer && ts.isJsxExpression(node.initializer)) {
        const value = node.initializer.expression && literalValue(node.initializer.expression);
        if (value !== null && value !== undefined) report(node.initializer, value);
      }
    } else if (ts.isJsxExpression(node) && node.parent && ts.isJsxElement(node.parent)) {
      const value = node.expression && literalValue(node.expression);
      if (value !== null && value !== undefined) report(node, value);
    } else if (ts.isCallExpression(node) && ["alert", "showAlert"].includes(callName(node))) {
      for (const argument of node.arguments.slice(0, 2)) {
        const value = literalValue(argument);
        if (value !== null) report(argument, value);
      }
    } else if (
      ts.isPropertyAssignment(node) &&
      ((ts.isIdentifier(node.name) && visibleAttributeNames.has(node.name.text)) ||
        (ts.isStringLiteral(node.name) && visibleAttributeNames.has(node.name.text)))
    ) {
      const value = literalValue(node.initializer);
      if (value !== null) report(node.initializer, value);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

const visibleTerminologyFailures = [];
const entryPattern = /^\s*"((?:[^"\\]|\\.)*)"\s*=\s*"((?:[^"\\]|\\.)*)"\s*;\s*$/gmu;
for (const [locale, forbiddenPattern] of Object.entries(localeRules)) {
  const catalogPath = path.resolve(projectRoot, `../BWChat/${locale}.lproj/Localizable.strings`);
  const catalog = await readFile(catalogPath, "utf8");
  for (const match of catalog.matchAll(entryPattern)) {
    const key = decodeStringsValue(match[1]);
    const value = decodeStringsValue(match[2]);
    if (forbiddenPattern.test(value) && !allowedCatalogKeys.has(key)) {
      visibleTerminologyFailures.push(`${locale}/${key}: ${value}`);
    }
  }
}

const reviewVisibleSourceFiles = await sourceFilesBelow(path.resolve(projectRoot, "src"));
for (const sourcePath of reviewVisibleSourceFiles) {
  auditReviewVisibleSource(
    sourcePath,
    await readFile(sourcePath, "utf8"),
    visibleTerminologyFailures,
  );
}

if (visibleTerminologyFailures.length > 0) {
  throw new Error(
    `Review-visible terminology audit failed:\n${visibleTerminologyFailures
      .map((failure) => `- ${failure}`)
      .join("\n")}`,
  );
}

console.log(
  `Review-visible terminology audit passed for ${Object.keys(localeRules).length} locales and ${reviewVisibleSourceFiles.length} app source files; ${allowedCatalogKeys.size} truthful StoreKit/legal entries are explicitly allowlisted.`,
);
