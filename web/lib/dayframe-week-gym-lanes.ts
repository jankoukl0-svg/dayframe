/** Give gym and ordinary calendar tasks separate lanes only when their times intersect. */
export type TimedWeekBlock={id:string;start:number;end:number;gym:boolean;completed?:boolean};
export type WeekLaneStyle={left:string;right:"auto";width:string};
export function placeWeekGymCollisions(blocks:TimedWeekBlock[],past=false):Record<string,WeekLaneStyle> {
  const result:Record<string,WeekLaneStyle>={};
  const items=blocks.filter(b=>(!past||b.completed)&&Number.isFinite(b.start)&&Number.isFinite(b.end)&&b.end>b.start)
    .sort((a,b)=>a.start-b.start||a.end-b.end||a.id.localeCompare(b.id));
  let group:TimedWeekBlock[]=[],maxEnd=-Infinity;
  const flush=()=>{
    if(group.length<2||!group.some(x=>x.gym))return;
    const laneEnds:number[]=[],assignments:{block:TimedWeekBlock;lane:number}[]=[];
    for(const block of group){
      let lane=laneEnds.findIndex(end=>end<=block.start);
      if(lane<0){lane=laneEnds.length;laneEnds.push(block.end);}
      else laneEnds[lane]=block.end;
      assignments.push({block,lane});
    }
    const width=100/laneEnds.length;
    for(const {block,lane} of assignments)result[block.id]={
      left:`calc(${(width*lane).toFixed(5)}% + 6px)`,
      right:"auto",width:`calc(${width.toFixed(5)}% - 12px)`,
    };
  };
  for(const item of items){
    if(group.length&&item.start>=maxEnd){flush();group=[];maxEnd=-Infinity;}
    group.push(item);maxEnd=Math.max(maxEnd,item.end);
  }
  flush();
  return result;
}
