"""Compares what real Pedro/ValleyLib did (java.txt) with what the visualizer predicted (gen/expect.json)."""
import json, sys, collections
run = sys.argv[1]
exp = {e['c']: e for e in json.load(open(run + '/gen/expect.json'))}
agree = miss = false_alarm = 0
maybe = collections.Counter()
kinds = collections.Counter()
for line in open(run + '/java.txt'):
    c, al, res = line.rstrip('\n').split(' ', 2)
    e = exp[int(c.rstrip('T'))]  # "12T" is routine 12 exported in the team layout
    predicted = len(e[al.lower()]) > 0
    threw = res != 'ok'
    if not predicted and len(e[al.lower() + 'Maybe']) > 0:
        maybe[threw] += 1
        continue
    if predicted == threw:
        agree += 1
    elif threw:
        miss += 1
        kinds['MISSED ' + res[:70]] += 1
        if miss <= 4: print('MISSED: case', c, al, 'bad=', e['bad'], '->', res)
    else:
        false_alarm += 1
        kinds['FALSE ALARM ' + ' | '.join(e[al.lower()])[:80]] += 1
        if false_alarm <= 4: print('FALSE ALARM: case', c, al, 'bad=', e['bad'], e[al.lower()])
print('agree', agree, 'missed', miss, 'false alarms', false_alarm, '| flagged "can throw":', maybe[True], 'threw,', maybe[False], 'did not')
for k, v in kinds.most_common(8): print('  ', v, k)
sys.exit(1 if miss or false_alarm else 0)
