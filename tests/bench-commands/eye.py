# eye.py [out.json] : the by-eye times (data/eyetimes.json) from the by-eye calls and the reference bar traces
# (data/reference, a CSRT tracker, not the phone's), smoothed by a 5-frame median. Needs numpy. Run: python3 -I eye.py
# stop = the eye's rep bottom start (first frame within 5% of travel of the lowest point; the same rule as run 1 and run 3).
# H = the Start! height: median over the 0.5 s before the descent; descent start D = last frame before the stop within 5% of travel of H.
# settled = first frame after which the bar stays within 5% of travel of H until D. back up = first frame after the bottom within 5% of travel of H.
import sys, json, os, numpy as np
DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')

def load(i):
    r = json.load(open(os.path.join(DATA, 'reference', f'{i}.json')))
    return np.array(r['t'], float), np.array([np.nan if y is None else y for y in r['y']], float)

sets = [('meet', os.path.join(DATA, 'calls-meet.json')), ('run1', os.path.join(DATA, 'calls-run1.json'))]
out = {}
for grp, cf in sets:
    for a in json.load(open(cf))['attempts']:
        if not os.path.exists(os.path.join(DATA, 'reference', f"{a['id']}.json")): continue
        T, Y = load(a['id'])
        Y = np.array([np.nanmedian(Y[max(0, i - 2):i + 3]) for i in range(len(Y))])
        stop, pend = a['reps'][0][0], a['reps'][0][1]
        nxt = a['reps'][1][0] if len(a['reps']) > 1 else T[-1] + 1
        wb = (T >= stop) & (T <= pend + 0.5); low = np.nanmax(Y[wb]); tb = T[wb][np.nanargmax(Y[wb])]
        H = np.nanmedian(Y[(T >= a['start'][0]) & (T <= a['start'][1])])
        for _ in range(3):
            trav = low - H; band = 0.05 * trav
            pre = np.where((T < stop) & (np.abs(Y - H) <= band))[0]
            D = pre[-1]
            H = np.nanmedian(Y[(T >= T[D] - 0.5) & (T <= T[D])])
        trav = low - H; band = 0.05 * trav
        k = D
        while k > 0 and abs(Y[k - 1] - H) <= band: k -= 1
        settled5 = T[k]
        k = D
        while k > 0 and abs(Y[k - 1] - H) <= 2 * band: k -= 1
        # settled: the later of the trace's 10% band and the start of the by-eye Start! window (lean late)
        settled = max(float(T[k]), a['start'][0])
        up = np.where((T > tb) & (T < nxt) & (np.abs(Y - H) <= band))[0]
        back = float(T[up[0]]) if len(up) else None
        out[a['id']] = {'grp': grp, 'call': a['reps'][0][2], 'start': a['start'], 'settled': round(float(settled), 3), 'settled5': round(float(settled5), 3), 'settled10': round(float(T[k]), 3), 'descent': round(float(T[D]), 3),
                        'stop': stop, 'pauseEnd': pend, 'bottom': round(float(tb), 3), 'backUp': back and round(back, 3), 'traceFrom': round(float(T[0]), 2)}
        print(f"{grp} {a['id'][:5]:5} {a['reps'][0][2]:13} eyeStart {a['start']} settled {settled:.2f} [10% {T[k]:.2f}, 5% {settled5:.2f}] (trace from {T[0]:.2f}) descent {T[D]:.2f} stop {stop} pause to {pend} bottom {tb:.2f} backUp {back}")
json.dump(out, open(sys.argv[1] if len(sys.argv) > 1 else os.path.join(DATA, 'eyetimes.json'), 'w'), indent=1)
