"""Apply Linux process limits before exec; this is not a filesystem/network sandbox."""
import os
import resource
import sys
import json


def main():
    cpu_seconds = int(sys.argv[1])
    with os.fdopen(3, "rb") as descriptor:
        data = descriptor.read(65537)
    if len(data) > 65536:
        raise ValueError("Converter invocation is too large")
    invocation = json.loads(data)
    if not isinstance(invocation, dict) or set(invocation) != {"command", "args"}:
        raise ValueError("Invalid converter invocation")
    executable, arguments = invocation["command"], invocation["args"]
    if (not isinstance(executable, str) or not executable or "\0" in executable
            or len(executable) > 4096 or not isinstance(arguments, list) or len(arguments) > 512
            or any(not isinstance(arg, str) or "\0" in arg or len(arg) > 32768 for arg in arguments)):
        raise ValueError("Invalid converter invocation")
    command = [executable, *arguments]
    if len(sys.argv) != 2 or cpu_seconds < 1 or cpu_seconds > 600:
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
