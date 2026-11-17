using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace TinkjamSync
{
    /// <summary>
    /// Every process the app starts goes in one job that Windows ends when the app's handle closes,
    /// so Sync and everything under it (cloudflared, agents) stop with the app, even if it crashes.
    /// </summary>
    public sealed class JobObject : IDisposable
    {
        IntPtr handle;

        public JobObject()
        {
            handle = CreateJobObject(IntPtr.Zero, null);
            if (handle == IntPtr.Zero) throw new Win32Exception();
            var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if (!SetInformationJobObject(handle, JobObjectExtendedLimitInformation, ref info, (uint)Marshal.SizeOf(info)))
                throw new Win32Exception();
        }

        /// <summary>Right after start: Node takes far longer to start anything of its own.</summary>
        public void Add(Process process)
        {
            if (!AssignProcessToJobObject(handle, process.Handle)) throw new Win32Exception();
        }

        /// <summary>Ends every process in the job now. The job stays usable for the next one.</summary>
        public void Terminate() => TerminateJobObject(handle, 1);

        public void Dispose()
        {
            if (handle == IntPtr.Zero) return;
            CloseHandle(handle);
            handle = IntPtr.Zero;
        }

        const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
        const int JobObjectExtendedLimitInformation = 9;

        [StructLayout(LayoutKind.Sequential)]
        struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct IO_COUNTERS
        {
            public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
            public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
            public IO_COUNTERS IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        static extern IntPtr CreateJobObject(IntPtr attributes, string name);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, uint length);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool TerminateJobObject(IntPtr job, uint exitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool CloseHandle(IntPtr handle);
    }

    public static class Native
    {
        /// <summary>"arm64" on an ARM PC even when this app runs emulated, else "x64".</summary>
        public static string MachineArch()
        {
            try
            {
                if (IsWow64Process2(Process.GetCurrentProcess().Handle, out _, out var machine) && machine == 0xAA64) return "arm64";
            }
            catch (EntryPointNotFoundException) { }
            var arch = Environment.GetEnvironmentVariable("PROCESSOR_ARCHITEW6432") ?? Environment.GetEnvironmentVariable("PROCESSOR_ARCHITECTURE");
            return string.Equals(arch, "ARM64", StringComparison.OrdinalIgnoreCase) ? "arm64" : "x64";
        }

        /// <summary>Lets --self-test and --dump-state print in the terminal that started them.</summary>
        public static void AttachParentConsole() => AttachConsole(-1);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool IsWow64Process2(IntPtr process, out ushort processMachine, out ushort nativeMachine);

        [DllImport("kernel32.dll")]
        static extern bool AttachConsole(int processId);
    }
}
