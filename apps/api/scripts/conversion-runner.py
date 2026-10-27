"""Apply Linux process limits before exec; this is not a filesystem/network sandbox."""
import os
import resource
import sys


def main():
    cpu_seconds = int(sys.argv[1])
    command = sys.argv[2:]
    if cpu_seconds < 1 or not command:
        raise ValueError("Invalid converter limits")
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_AS, (1024 ** 3, 1024 ** 3))
    resource.setrlimit(resource.RLIMIT_FSIZE, (256 * 1024 ** 2, 256 * 1024 ** 2))
    resource.setrlimit(resource.RLIMIT_NOFILE, (128, 128))
    resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds))
    try:
        os.execvpe(command[0], command, os.environ)
    except (FileNotFoundError, PermissionError):
        raise SystemExit(127)


if __name__ == "__main__":
    main()
