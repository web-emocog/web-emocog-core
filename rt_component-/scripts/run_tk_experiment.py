import argparse
import os, time, random
import tkinter as tk

from rt_mvp.config import ProjectConfig
from rt_mvp.sinks import JsonlSink
from rt_mvp.event_schema import base_event

KEYMAP = {"space":"space","Left":"left","Right":"right"}

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--task", required=True, choices=["simple","choice","go_nogo","stroop","pvt","cpt"])
    p.add_argument("--trials", type=int, default=20)
    p.add_argument("--go_ratio", type=float, default=0.7)
    p.add_argument("--session_id", type=str, default="demo_session")
    p.add_argument("--config", type=str, default=None)
    args=p.parse_args()

    cfg=ProjectConfig.load(args.config)
    bounds=cfg.task_bounds.get(args.task, cfg.task_bounds["simple"])

    ts=time.strftime("%Y-%m-%dT%H-%M-%S", time.localtime())
    run_id=f"rt_tk_{ts}_{args.task}"
    log_path=os.path.join("logs", f"{run_id}.jsonl")
    sink=JsonlSink(log_path)

    t0=time.perf_counter()
    def mono(): return time.perf_counter()-t0

    trials=[]
    for i in range(args.trials):
        if args.task=="choice":
            exp="left" if random.getrandbits(1) else "right"
            trials.append((i+1, exp, exp, None))
        elif args.task=="go_nogo":
            is_go = (random.random() < args.go_ratio)
            if is_go: trials.append((i+1, "go", "space", True))
            else: trials.append((i+1, "nogo", None, False))
        else:
            trials.append((i+1, "simple", "space", None))

    root=tk.Tk()
    root.title("RT TK demo")
    root.geometry("760x420")
    label=tk.Label(root,text="SPACE чтобы начать",font=("Arial",30)); label.pack(expand=True)
    sub=tk.Label(root,text="← → и SPACE",font=("Arial",14)); sub.pack()

    state={"idx":-1,"trial_id":None,"expected":None,"is_go":None}

    def emit(event_type, **payload):
        ev=base_event(event_type=event_type, session_id=args.session_id, run_id=run_id, t_mono_s=mono(),
                      trial_id=payload.pop("trial_id", None), block_id=1, task_variant=args.task, **payload)
        sink.emit(ev)

    def on_key(e):
        keysym=getattr(e,"keysym","")
        b=KEYMAP.get(keysym, f"other:{keysym}")
        emit("keypress", trial_id=state["trial_id"], button_id=b)

    def next_trial():
        state["idx"]+=1
        if state["idx"]>=len(trials):
            emit("session_end")
            label.config(text="Готово ✅"); sub.config(text=f"log: {log_path}")
            root.after(1200, root.destroy)
            return
        tid, stim_type, expected, is_go = trials[state["idx"]]
        state["trial_id"]=tid; state["expected"]=expected; state["is_go"]=is_go
        emit("trial_start", trial_id=tid)
        label.config(text="+"); sub.config(text=f"{tid}/{len(trials)}")
        root.after(random.randint(500,1500), stim_on)

    def stim_on():
        tid=state["trial_id"]
        if args.task=="choice":
            txt="←" if state["expected"]=="left" else "→"; hint="Нажми ← или →"
        elif args.task=="go_nogo":
            if state["is_go"] is True: txt="GO"; hint="Нажми SPACE"
            else: txt="NO-GO"; hint="НЕ НАЖИМАЙ"
        else:
            txt="●"; hint="Нажми SPACE"
        label.config(text=txt); sub.config(text=hint)
        emit("stimulus_on", trial_id=tid, stimulus_id=stim_type, stimulus_type=stim_type,
             expected_response=state["expected"], is_go=state["is_go"], timeout_ms=bounds.timeout_ms)
        root.after(bounds.timeout_ms, stim_off)

    def stim_off():
        tid=state["trial_id"]
        emit("stimulus_off", trial_id=tid)
        label.config(text=""); sub.config(text="")
        root.after(150, end_trial)

    def end_trial():
        tid=state["trial_id"]
        emit("trial_end", trial_id=tid)
        root.after(150, next_trial)

    def start(e):
        if getattr(e,"keysym","")=="space":
            root.unbind("<KeyPress>")
            root.bind("<KeyPress>", on_key)
            emit("session_start")
            root.after(100, next_trial)

    root.bind("<KeyPress>", start)
    root.mainloop()
    print("LOG:", log_path)

if __name__=="__main__":
    main()
