#!/usr/bin/env python3
"""Independent, standard-library check of selected WeCog long-format metrics."""

import argparse
import csv
import json
import math
import statistics
from collections import defaultdict


def rows_from(filename):
    with open(filename, encoding='utf-8-sig', newline='') as handle:
        if filename.endswith('.csv'):
            return [row for row in csv.DictReader(handle) if row['source_kind'] != 'manifest']
        bundle = json.load(handle)
        if bundle.get('schemaVersion') != 'reproducibility_export.v1':
            raise ValueError('Unsupported export version')
        return bundle['rows']


def observed(value):
    if value in (None, '') or isinstance(value, bool):
        return None
    value = float(value)
    if not math.isfinite(value):
        raise ValueError('Nonfinite measurement')
    return value


def recalculate(rows):
    # Pool correct accepted RT within participant; equal weight between participants.
    key = lambda row: (row.get('session_id'), row.get('presentation_id'))
    correct = {key(row) for row in rows if row.get('metric') == 'task.correct'
               and row.get('value') in (True, 'true') and row.get('attempt_status') == 'accepted'
               and row.get('presentation_id')}
    participants = defaultdict(list)
    windows = defaultdict(dict)
    seen = set()
    for row in rows:
        if row.get('metric') == 'task.rt_ms' and row.get('presentation_id') and row.get('participant_id'):
            if key(row) in seen:
                raise ValueError('Duplicate presentation in the export')
            seen.add(key(row))
            value = observed(row.get('value'))
            if value is not None and value >= 0 and key(row) in correct and row.get('attempt_status') == 'accepted':
                participants[(row.get('group_id') or 'unassigned', row['participant_id'])].append(value)
        if row.get('source_kind') == 'physiology_interval' and row.get('scope') == 'minute':
            session_channel = (row['session_id'], row['channel'])
            start, end = map(float, (row['interval_start_ms'], row['interval_end_ms']))
            duration, cover = end - start, float(row['observed_ms'])
            if start in windows[session_channel] or duration <= 0 or not 0 <= cover <= duration:
                raise ValueError('Invalid or duplicate minute')
            windows[session_channel][start] = (duration, cover, observed(row.get('value')))
    groups = defaultdict(list)
    for (group, _participant), values in participants.items():
        groups[group].append(statistics.median(values))
    physiology = []
    for (session, channel), minutes in sorted(windows.items()):
        observed_ms = sum(cover for _, cover, _ in minutes.values())
        duration_ms = sum(duration for duration, _, _ in minutes.values())
        physiology.append({'session_id': session, 'channel': channel, 'minutes': len(minutes),
                           'missing_minutes': sum(value is None for _, _, value in minutes.values()),
                           'coverage_fraction': observed_ms / duration_ms})
    return {'groups': {group: {'participants': len(values), 'median_of_participant_medians_ms': statistics.median(values)}
                       for group, values in sorted(groups.items())}, 'physiology': physiology}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('export', help='A reproducibility_export.v1 JSON or CSV')
    print(json.dumps(recalculate(rows_from(parser.parse_args().export)), indent=2, allow_nan=False))
