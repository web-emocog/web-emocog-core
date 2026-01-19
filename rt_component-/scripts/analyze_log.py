import argparse
from rt_mvp.analyzer import analyze_and_report

def main():
    p=argparse.ArgumentParser()
    p.add_argument("log_path")
    p.add_argument("--task", required=True, choices=["simple","choice","go_nogo","stroop","pvt","cpt"])
    p.add_argument("--config", type=str, default=None)
    args=p.parse_args()
    summary = analyze_and_report(args.log_path, args.task, config_path=args.config)
    print("OK. reports written.")
    for k,v in summary.get("flags", {}).items():
        print(f"{k}: {v.get('value')}")

if __name__=="__main__":
    main()
