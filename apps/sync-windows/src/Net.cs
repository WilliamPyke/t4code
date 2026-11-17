using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Threading;
using System.Threading.Tasks;

namespace TinkjamSync
{
    /// <summary>A failure in words for the person. `Offline` ones try again by themselves.</summary>
    public sealed class SetupException : Exception
    {
        public readonly bool Offline;
        public SetupException(string message, bool offline = false) : base(message) { Offline = offline; }
    }

    public static class Net
    {
        static readonly HttpClient Client = CreateClient();

        static HttpClient CreateClient()
        {
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            var client = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
            client.DefaultRequestHeaders.UserAgent.ParseAdd("TinkjamSync/" + AppInfo.ShortVersion);
            client.DefaultRequestHeaders.CacheControl = new CacheControlHeaderValue { NoCache = true };
            return client;
        }

        static SetupException Explain(Exception error, string what)
        {
            if (error is SetupException setup) return setup;
            // A dropped connection mid-download is an IOException around the socket error; a full disk has none.
            if (error is HttpRequestException || error is WebException || error is OperationCanceledException ||
                (error is IOException && error.InnerException != null))
                return new SetupException("can't reach the internet to " + what + ".", offline: true);
            return new SetupException("Couldn't " + what + ": " + error.Message);
        }

        public static async Task<Dictionary<string, object>> GetJson(string url, string what)
        {
            try
            {
                using (var cancel = new CancellationTokenSource(TimeSpan.FromSeconds(20)))
                using (var response = await Client.GetAsync(url, cancel.Token).ConfigureAwait(false))
                {
                    if (!response.IsSuccessStatusCode)
                        throw new SetupException("Couldn't " + what + ": the server answered " + (int)response.StatusCode + ".");
                    return Json.Parse(await response.Content.ReadAsStringAsync().ConfigureAwait(false));
                }
            }
            catch (Exception error) { throw Explain(error, what); }
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
                    if (!response.IsSuccessStatusCode)
                        throw new SetupException("Couldn't " + what + ": the server answered " + (int)response.StatusCode + ".");
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
