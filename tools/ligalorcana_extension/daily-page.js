async function command(cmd,extra={}) {
 const result=await chrome.runtime.sendMessage({cmd,...extra});
 document.getElementById('result').textContent=JSON.stringify(result,null,2);
}
document.getElementById('enable').onclick=()=>command('dailyConfigure',{enabled:true});
document.getElementById('disable').onclick=()=>command('dailyConfigure',{enabled:false});
document.getElementById('test').onclick=()=>command('dailyTick',{dryRun:true});
// The scheduled URL may only tick an explicitly enabled configuration.
command(new URLSearchParams(location.search).has('tick')?'dailyTick':'dailyStatus',
 {dryRun:new URLSearchParams(location.search).has('dryRun')});
