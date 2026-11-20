using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Authentication;
using System.Threading;
using System.Threading.Tasks;

namespace TinkjamSync
{
    /// <summary>A failure in words for the person. `RetrySoon` ones try again within a minute.</summary>
    public sealed class SetupException : Exception
    {
        public readonly bool RetrySoon;
        public SetupException(string message, bool retrySoon = false) : base(message) { RetrySoon = retrySoon; }
    }

    public static class Net
    {
        static readonly HttpClient Client = CreateClient();

        static HttpClient CreateClient()
        {
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            // A work proxy that signs people in with their Windows account answers 407 without this.
            var handler = new HttpClientHandler { DefaultProxyCredentials = CredentialCache.DefaultCredentials };
            var client = new HttpClient(handler) { Timeout = Timeout.InfiniteTimeSpan };
            client.DefaultRequestHeaders.UserAgent.ParseAdd("TinkjamSync/" + AppInfo.ShortVersion);
            client.DefaultRequestHeaders.CacheControl = new CacheControlHeaderValue { NoCache = true };
            return client;
        }

        /// <summary>The proxy Windows uses for the open internet, as Node wants it, or null for none.</summary>
        public static string SystemProxy()
        {
            try
            {
                var target = new Uri("https://registry.npmjs.org/");
                var proxy = WebRequest.GetSystemWebProxy();
                if (proxy == null || proxy.IsBypassed(target)) return null;
                var address = proxy.GetProxy(target);
                return address == null || address == target ? null : address.GetLeftPart(UriPartial.Authority);
            }
            catch (Exception error)
            {
                Log.App("Couldn't read the system proxy: " + error.Message);
                return null;
            }
        }

        static bool Blocked(Exception error)
        {
            for (var cause = error; cause != null; cause = cause.InnerException)
            {
                if (cause is AuthenticationException) return true;
                if (cause is WebException web &&
                    (web.Status == WebExceptionStatus.TrustFailure || web.Status == WebExceptionStatus.SecureChannelFailure ||
                     web.Status == WebExceptionStatus.RequestProhibitedByProxy || web.Status == WebExceptionStatus.ProxyNameResolutionFailure))
                    return true;
            }
            return false;
        }

        static bool DiskFull(Exception error)
        {
            var code = error.HResult & 0xFFFF;
            return error is IOException && (code == 0x70 || code == 0x27);
        }

        static SetupException Explain(Exception error, string what)
        {
            if (error is SetupException setup) return setup;
            Log.App("Couldn't " + what + ": " + error.GetType().Name + ": " + error.GetBaseException().Message);
            if (Blocked(error)) return new SetupException(Words.Restricted, retrySoon: true);
            if (DiskFull(error)) return new SetupException(Words.DiskFull);
            // A dropped connection mid-download is an IOException around the socket error.
            if (error is HttpRequestException || error is WebException || error is OperationCanceledException ||
                (error is IOException && error.InnerException != null))
                return new SetupException(Words.Offline, retrySoon: true);
            return new SetupException(Words.Unexpected);
        }

        static SetupException Refused(HttpStatusCode status, string what)
        {
            Log.App("Couldn't " + what + ": the server answered " + (int)status);
            var blocked = status == HttpStatusCode.ProxyAuthenticationRequired || status == HttpStatusCode.Forbidden || (int)status == 451;
            return new SetupException(blocked ? Words.Restricted : Words.ServerTrouble, retrySoon: true);
        }

        public static async Task<Dictionary<string, object>> GetJson(string url, string what)
        {
            try
            {
                using (var cancel = new CancellationTokenSource(TimeSpan.FromSeconds(20)))
                using (var response = await Client.GetAsync(url, cancel.Token).ConfigureAwait(false))
                {
                    if (!response.IsSuccessStatusCode) throw Refused(response.StatusCode, what);
                    return Json.Parse(await response.Content.ReadAsStringAsync().ConfigureAwait(false));
                }
            }
            catch (Exception error) { throw Explain(error, what); }
        }

        /// <summary>The first address that answers; the last one's failure when none does.</summary>
        public static async Task<Dictionary<string, object>> GetJson(string[] urls, string what)
        {
            for (var i = 0; ; i++)
            {
                try { return await GetJson(urls[i], what).ConfigureAwait(false); }
                catch (SetupException) when (i < urls.Length - 1) { }
            }
        }

        /// <summary>Downloads to `path` through a .part file; reports whole percents when the size is known.</summary>
        public static async Task Download(string url, string path, string what, Action<int> progress)
        {
            var partial = path + ".part";
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(path));
                using (var cancel = new CancellationTokenSource(TimeSpan.FromMinutes(20)))
                using (var response = await Client.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, cancel.Token).ConfigureAwait(false))
                {
                    if (!response.IsSuccessStatusCode) throw Refused(response.StatusCode, what);
                    var total = response.Content.Headers.ContentLength;
                    using (var source = await response.Content.ReadAsStreamAsync().ConfigureAwait(false))
                    using (var target = new FileStream(partial, FileMode.Create, FileAccess.Write, FileShare.None))
                    {
                        var buffer = new byte[81920];
                        long done = 0;
                        var reported = -1;
                        int read;
                        while ((read = await source.ReadAsync(buffer, 0, buffer.Length, cancel.Token).ConfigureAwait(false)) > 0)
                        {
                            await target.WriteAsync(buffer, 0, read, cancel.Token).ConfigureAwait(false);
                            done += read;
                            if (total > 0 && progress != null)
                            {
                                var percent = (int)(done * 100 / total.Value);
                                if (percent != reported) { reported = percent; progress(percent); }
                            }
                        }
                    }
                }
                if (File.Exists(path)) File.Delete(path);
                File.Move(partial, path);
            }
            catch (Exception error)
            {
                try { File.Delete(partial); } catch (Exception) { }
                throw Explain(error, what);
            }
        }
    }
}
