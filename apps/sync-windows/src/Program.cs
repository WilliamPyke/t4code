using System;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;

namespace TinkjamSync
{
    public static class AppInfo
    {
        /// <summary>The full build version, e.g. 0.1.0+202611171900 (the build script stamps it).</summary>
        public static readonly string Version =
            typeof(AppInfo).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "0.0.0";

        public static string ShortVersion => Version.Split('+')[0];
    }

    static class Program
    {
        [STAThread]
        static int Main(string[] argv)
        {
            var args = AppArgs.Parse(argv);
            if (args.SelfTest || args.DumpState || args.PrintVersion) Native.AttachParentConsole();
            if (args.SelfTest) return SelfTest.Run();
            if (args.PrintVersion)
            {
                Console.WriteLine("Tinkjam Sync " + AppInfo.Version);
                return 0;
            }
            if (args.PreviewUi)
            {
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                return Preview.Run(args);
            }
            var home = Home.Resolve(args);
            if (args.DumpState) return Instance.DumpState(home);
            if (args.Quit) return Instance.RequestQuit(home, TimeSpan.FromSeconds(30)) ? 0 : 1;

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            if (args.Uninstall) return Installer.Uninstall(home, args);
            if (args.Install || Installer.LooksLikeSetup()) return Installer.Install(home, args);

            using (var mutex = new Mutex(true, home.MutexName, out var first))
            {
                if (!first)
                {
                    Instance.Signal(home, "show");
                    return 0;
                }
                SynchronizationContext.SetSynchronizationContext(new WindowsFormsSynchronizationContext());
                Log.Init(home);
                Log.App("Tinkjam Sync " + AppInfo.Version + " started" + (args.Autostart ? " at log-in" : "") + " for " + home.BaseDir);
                Application.ThreadException += (s, e) => Log.App("Unexpected error: " + e.Exception);
                AppDomain.CurrentDomain.UnhandledException += (s, e) => Log.App("Unexpected error: " + e.ExceptionObject);
                Application.Run(new TrayApp(home, Settings.Load(home), args));
                mutex.ReleaseMutex();
            }
            return 0;
        }
    }
}
