/* recurrence-builder.js — guided builder that writes recurrence syntax.
   Keyboard-navigable via the shared KbForm mixin: the task-detail drawer "enters"
   it (delegating keys to this component's kbKey) — j/k move between controls, h/l
   within a chip row, space toggles, i edits an input, Esc exits back to the drawer.
   `active` gates the kfocus highlight so it only shows while the drawer is in here. */
window.RecurrenceBuilder = {
  props: ['modelValue','anchor','active'],
  emits: ['update:modelValue'],
  mixins: [window.KbForm],
  template: `
  <div class="recbuilder">
    <!-- frequency selector -->
    <div class="chips" style="margin-bottom:8px;">
      <span class="chip" :class="[{on: freq==='none'},    active ? kbCls('freq',0) : null]" @click="setFreq('none')">none</span>
      <span class="chip" :class="[{on: freq==='daily'},   active ? kbCls('freq',1) : null]" @click="setFreq('daily')">daily</span>
      <span class="chip" :class="[{on: freq==='weekly'},  active ? kbCls('freq',2) : null]" @click="setFreq('weekly')">weekly</span>
      <span class="chip" :class="[{on: freq==='monthly'}, active ? kbCls('freq',3) : null]" @click="setFreq('monthly')">monthly</span>
    </div>

    <!-- DAILY -->
    <div v-if="freq==='daily'" class="bgroup" style="margin-bottom:8px;">
      <div class="bg-label">interval</div>
      <div class="chips" style="align-items:center;">
        <span class="mut">every</span>
        <input ref="dInterval" class="input" :class="active ? kbCls('dInterval') : null" style="width:48px;text-align:center;" type="number" min="1" v-model.number="dInterval" @input="emit" @keydown.esc.stop.prevent="$event.target.blur()" />
        <span class="mut">day(s)</span>
      </div>
    </div>

    <!-- WEEKLY -->
    <div v-if="freq==='weekly'" style="margin-bottom:8px;">
      <div class="bgroup" style="margin-bottom:6px;">
        <div class="bg-label">on days</div>
        <div class="chips">
          <span v-for="(w,i) in WD" :key="i" class="chip" :class="[{on: wDays.includes(i)}, active ? kbCls('wdays',i) : null]" @click="toggleDay(i)">{{ w }}</span>
        </div>
        <div class="chips" style="margin-top:4px;">
          <span class="chip" :class="active ? kbCls('presets',0) : null" @click="preset([1,3,5])">MWF</span>
          <span class="chip" :class="active ? kbCls('presets',1) : null" @click="preset([2,4])">Tu/Th</span>
          <span class="chip" :class="active ? kbCls('presets',2) : null" @click="preset([6,0])">Sat/Sun</span>
          <span class="chip" :class="active ? kbCls('presets',3) : null" @click="preset([1,2,3,4,5])">weekdays</span>
        </div>
      </div>
      <div class="bgroup">
        <div class="bg-label">repeat</div>
        <div class="chips" style="align-items:center;">
          <span class="mut">every</span>
          <input ref="wInterval" class="input" :class="active ? kbCls('wInterval') : null" style="width:48px;text-align:center;" type="number" min="1" v-model.number="wInterval" @input="emit" @keydown.esc.stop.prevent="$event.target.blur()" />
          <span class="mut">week(s)</span>
        </div>
      </div>
    </div>

    <!-- MONTHLY -->
    <div v-if="freq==='monthly'" style="margin-bottom:8px;">
      <div class="chips" style="margin-bottom:6px;">
        <span class="chip" :class="[{on: mMode==='day'},     active ? kbCls('mMode',0) : null]" @click="mMode='day';emit()">on a date</span>
        <span class="chip" :class="[{on: mMode==='weekday'}, active ? kbCls('mMode',1) : null]" @click="mMode='weekday';emit()">on a weekday</span>
      </div>
      <div v-if="mMode==='day'" class="chips" style="align-items:center;margin-bottom:6px;">
        <span class="mut">on day</span>
        <input ref="mDay" class="input" :class="active ? kbCls('mDay') : null" style="width:52px;text-align:center;" type="number" min="1" max="31" v-model.number="mDay" @input="emit" @keydown.esc.stop.prevent="$event.target.blur()" />
      </div>
      <div v-if="mMode==='weekday'" class="chips" style="align-items:center;margin-bottom:6px;">
        <span class="mut">on the</span>
        <select ref="mOrd" class="input" :class="active ? kbCls('mOrd') : null" style="width:auto;" v-model="mOrd" @change="emit" @keydown.esc.stop.prevent="$event.target.blur()">
          <option value="1">1st</option><option value="2">2nd</option><option value="3">3rd</option>
          <option value="4">4th</option><option value="-1">last</option>
        </select>
        <select ref="mWeekday" class="input" :class="active ? kbCls('mWeekday') : null" style="width:auto;" v-model.number="mWeekday" @change="emit" @keydown.esc.stop.prevent="$event.target.blur()">
          <option v-for="(w,i) in WDfull" :key="i" :value="i">{{ w }}</option>
        </select>
      </div>
      <div class="bgroup">
        <div class="bg-label">repeat</div>
        <div class="chips" style="align-items:center;">
          <span class="mut">every</span>
          <input ref="mInterval" class="input" :class="active ? kbCls('mInterval') : null" style="width:48px;text-align:center;" type="number" min="1" v-model.number="mInterval" @input="emit" @keydown.esc.stop.prevent="$event.target.blur()" />
          <span class="mut">month(s)</span>
        </div>
      </div>
    </div>

    <!-- syntax (editable) + preview -->
    <div v-if="freq!=='none'" class="field" style="margin-bottom:6px;">
      <label>syntax <span class="mut">— editable, reusable</span></label>
      <input ref="raw" class="input cy" :class="active ? kbCls('raw') : null" v-model="raw" @input="onRaw" @blur="syncFromRaw" @keydown.esc.stop.prevent="$event.target.blur()" placeholder="e.g. every 2 weeks on mon,wed" />
    </div>
    <div v-if="freq!=='none'" class="rec-summary">
      ↻ {{ summary }}
    </div>
    <div v-if="freq!=='none' && preview.length" class="rec-preview">
      next: <b>{{ preview.join('  ·  ') }}</b>
    </div>
    <div v-if="freq!=='none' && !preview.length" class="rec-preview rd">⚠ pattern doesn't resolve — check syntax</div>
  </div>
  `,
  data(){
    return {
      kbAutoListen:false,   // the task-detail drawer drives kbKey via delegation
      kbAutofocus:false,    // entering lands on the frequency row, not an input
      freq:'none',
      raw:'',
      dInterval:1,
      wDays:[1], wInterval:1,
      mMode:'day', mDay:1, mOrd:'1', mWeekday:1, mInterval:1,
      WD: Rec.WD.map(w=>w), // sun..sat
      WDfull: Rec.WD_FULL,
    };
  },
  computed: {
    summary(){ return this.raw ? Rec.summary(this.raw) : ''; },
    preview(){
      if(!this.raw) return [];
      const occ = Rec.nextOccurrences(this.raw, { anchor:this.anchor||undefined, from:this.anchor||undefined, count:3, inclusive:false });
      return occ.map(d=>Rec.ymd(d).slice(5));
    }
  },
  watch: {
    modelValue(v){ if(v !== this.raw) this.loadFrom(v); }
  },
  mounted(){ this.loadFrom(this.modelValue); },
  methods: {
    // KbForm rows — dynamic by frequency (j/k between controls, h/l within a chip row)
    kbRows(){
      const rows=[{ id:'freq', type:'grid', items:['none','daily','weekly','monthly'], cols:99, select:f=>this.setFreq(f) }];
      if(this.freq==='daily'){
        rows.push({ id:'dInterval', type:'input', ref:'dInterval' });
      } else if(this.freq==='weekly'){
        rows.push({ id:'wdays',   type:'grid',  items:[0,1,2,3,4,5,6], cols:99, select:i=>this.toggleDay(i) });
        rows.push({ id:'presets', type:'grid',  items:[[1,3,5],[2,4],[6,0],[1,2,3,4,5]], cols:99, select:a=>this.preset(a) });
        rows.push({ id:'wInterval', type:'input', ref:'wInterval' });
      } else if(this.freq==='monthly'){
        rows.push({ id:'mMode', type:'grid', items:['day','weekday'], cols:99, select:m=>{ this.mMode=m; this.emit(); } });
        if(this.mMode==='day') rows.push({ id:'mDay', type:'input', ref:'mDay' });
        else { rows.push({ id:'mOrd', type:'input', ref:'mOrd' }); rows.push({ id:'mWeekday', type:'input', ref:'mWeekday' }); }
        rows.push({ id:'mInterval', type:'input', ref:'mInterval' });
      }
      if(this.freq!=='none') rows.push({ id:'raw', type:'input', ref:'raw' });
      return rows;
    },
    loadFrom(str){
      this.raw = str || '';
      if(!str){ this.freq='none'; return; }
      const r = Rec.parse(str);
      if(!r || r.type==='invalid'){ return; }
      if(r.type==='daily'){ this.freq='daily'; this.dInterval=r.interval; }
      else if(r.type==='weekly'){ this.freq='weekly'; this.wDays=(r.days&&r.days.length)?[...r.days]:[1]; this.wInterval=r.interval; }
      else if(r.type==='monthly-day'){ this.freq='monthly'; this.mMode='day'; this.mDay=r.day||1; this.mInterval=r.interval; }
      else if(r.type==='monthly-weekday'){ this.freq='monthly'; this.mMode='weekday'; this.mOrd=String(r.ord); this.mWeekday=r.weekday; this.mInterval=r.interval; }
    },
    setFreq(f){
      this.freq=f;
      this.kbRow=0; this.kbCell=0; this.kbGoalCol=0;   // rows changed; reset to the frequency row
      if(f==='none'){ this.raw=''; this.$emit('update:modelValue',''); return; }
      this.emit();
    },
    toggleDay(i){
      const idx=this.wDays.indexOf(i);
      if(idx>=0) this.wDays.splice(idx,1); else this.wDays.push(i);
      this.wDays.sort((a,b)=>a-b);
      if(!this.wDays.length) this.wDays=[i];
      this.emit();
    },
    preset(days){ this.wDays=[...days].sort((a,b)=>a-b); this.emit(); },
    build(){
      let r=null;
      if(this.freq==='daily') r={type:'daily', interval:Math.max(1,this.dInterval||1)};
      else if(this.freq==='weekly') r={type:'weekly', interval:Math.max(1,this.wInterval||1), days:this.wDays.length?this.wDays:[1]};
      else if(this.freq==='monthly'){
        if(this.mMode==='day') r={type:'monthly-day', interval:Math.max(1,this.mInterval||1), day:Math.min(31,Math.max(1,this.mDay||1))};
        else r={type:'monthly-weekday', interval:Math.max(1,this.mInterval||1), ord:parseInt(this.mOrd), weekday:this.mWeekday};
      }
      return r ? Rec.stringify(r) : '';
    },
    emit(){
      this.$nextTick(()=>{
        this.raw = this.build();
        this.$emit('update:modelValue', this.raw);
      });
    },
    onRaw(){ this.$emit('update:modelValue', this.raw); },
    syncFromRaw(){ this.loadFrom(this.raw); }
  }
};
