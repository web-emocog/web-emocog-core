import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const EXPRESSION_METHODS = Object.freeze(['geometry', 'blendshapes', 'combined']);
export const EXPRESSION_LABELS = Object.freeze(['neutral', 'happiness', 'sadness', 'anger', 'fear', 'surprise', 'disgust']);

export async function readExpressionBenchmark(file) {
    const limit = 10 * 1024 * 1024;
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const info = await handle.stat();
        if (!info.isFile() || info.size > limit) throw new Error('expression_benchmark_too_large');
        const buffer = Buffer.alloc(limit + 1);
        let size = 0;
        while (size < buffer.length) {
            const { bytesRead } = await handle.read(buffer, size, buffer.length - size, size);
            if (!bytesRead) break;
            size += bytesRead;
        }
        if (size > limit) throw new Error('expression_benchmark_too_large');
        return JSON.parse(buffer.subarray(0, size).toString('utf8'));
    } finally { await handle.close(); }
}

// Input contains independently labelled expressions and already-produced
// predictions. This evaluator neither trains nor selects a production model.
export function compareExpressions(input) {
    if (input?.schemaVersion !== 'expression-comparison.v1' || !Array.isArray(input.rows) || !input.rows.length) {
        throw new Error('invalid_expression_benchmark');
    }
    const subjects = new Map(), labels = new Set(EXPRESSION_LABELS);
    for (const row of input.rows) {
        if (typeof row.subject !== 'string' || !row.subject.trim() || row.subject !== row.subject.trim()
            || !['validation', 'test'].includes(row.split)
            || !labels.has(row.expected)) throw new Error('invalid_expression_benchmark_row');
        if (subjects.has(row.subject) && subjects.get(row.subject) !== row.split) throw new Error('expression_subject_split_leakage');
        subjects.set(row.subject, row.split);
        for (const method of EXPRESSION_METHODS) {
            const predicted = row.predictions?.[method];
            if (predicted != null && predicted !== 'unknown' && !labels.has(predicted)) throw new Error('invalid_expression_prediction');
        }
    }
    const rows = input.rows.filter(row => row.split === 'test');
    if (!rows.length) throw new Error('expression_test_split_missing');
    const methods = {};
    for (const method of EXPRESSION_METHODS) {
        const confusion = Object.fromEntries(EXPRESSION_LABELS.map(label =>
            [label, Object.fromEntries([...EXPRESSION_LABELS, 'unknown'].map(predicted => [predicted, 0]))]));
        let correct = 0, missing = 0, neutralFalsePositives = 0, neutrals = 0;
        for (const row of rows) {
            const predicted = row.predictions?.[method] || 'unknown';
            confusion[row.expected][predicted]++;
            if (predicted === 'unknown') missing++;
            if (predicted === row.expected) correct++;
            if (row.expected === 'neutral') {
                neutrals++;
                if (predicted !== 'unknown' && predicted !== 'neutral') neutralFalsePositives++;
            }
        }
        const perClass = EXPRESSION_LABELS.map(label => {
            const tp = confusion[label][label];
            const actual = Object.values(confusion[label]).reduce((sum, value) => sum + value, 0);
            const predicted = EXPRESSION_LABELS.reduce((sum, other) => sum + confusion[other][label], 0);
            return { label, n: actual, f1: 2 * tp / (actual + predicted || 1),
                recall: actual ? tp / actual : null };
        });
        const present = perClass.filter(row => row.n > 0);
        methods[method] = { n: rows.length, accuracy: correct / rows.length,
            missingRate: missing / rows.length, neutralFalsePositiveRate: neutrals ? neutralFalsePositives / neutrals : null,
            macroF1: present.reduce((sum, row) => sum + row.f1, 0) / present.length,
            evaluatedClasses: present.map(row => row.label), perClass, confusion };
    }
    return { schemaVersion: 'expression-comparison-report.v1', split: 'test',
        subjects: new Set(rows.map(row => row.subject)).size, n: rows.length, methods,
        limitation: 'Visible expression labels are not ground truth for internal emotional state.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    try {
        if (process.argv.length !== 3) throw new Error('usage_compare_expressions_private_json');
        const file = resolve(process.argv[2]);
        process.stdout.write(JSON.stringify(compareExpressions(await readExpressionBenchmark(file)), null, 2) + '\n');
    } catch (error) {
        const message = error instanceof SyntaxError ? 'invalid_expression_benchmark_json'
            : /^(invalid_expression_|expression_|usage_compare_)[a-z_]+$/.test(error.message)
                ? error.message : 'expression_benchmark_failed';
        process.stderr.write(message + '\n');
        process.exitCode = 1;
    }
}
