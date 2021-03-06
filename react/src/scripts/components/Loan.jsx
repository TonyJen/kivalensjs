'use strict'

import React from 'react'
import Reflux from 'reflux'
var Highcharts = require('react-highcharts/bundle/ReactHighcharts')
//import ReactCSSTransitionGroup from 'react-addons-css-transition-group'
import {History} from 'react-router'
import InfiniteList from './InfiniteList.jsx'
import {Tabs,Tab,Grid,Col,Row,ProgressBar,Panel,Button,Jumbotron,Alert} from 'react-bootstrap'
import TimeAgo from 'react-timeago'
import {KivaImage, NewTabLink, LoanLink, KivaLink, LoanListItem} from '.'
import {req} from '../api/kiva'
import a from '../actions'
import s from '../stores/'
import numeral from 'numeral'
import extend from 'extend'

//import {ImmutableOptimizations} from 'react-cursor'

const DTDD = ({term, def}) => <span><dt>{term}</dt><dd>{def}</dd></span>

//prevents components inside of this wrapper from being updated unless they update themselves.
const NoUpdate = React.createClass({
    shouldComponentUpdate({cycle}){return cycle == this.props.cycle},
    render(){return <div>{this.props.children}</div>}
})

const DeadZone = React.createClass({
    shouldComponentUpdate({until}){
        var newValue = until()
        var shouldUpdate = this.oldValue != newValue
        this.oldValue = newValue
        return shouldUpdate
    },
    render(){return <div>{this.props.children}</div>}
})

const RepaymentGraphs= React.createClass({
    getInitialState(){
        let {loan} = this.props
        return {loan, config: this.produceConfig(loan)}
    },
    //shouldComponentUpdate({loan}){return (loan.id != this.props.loan.id)},
    componentWillReceiveProps({loan}){this.rebuildGraph(loan)},
    rebuildGraph(loan){
        this.setState({loan, config: this.produceConfig(loan)})
    },
    ensureRepaymentsGraph(loan){
        if (loan.kl_repay_categories || !loan.kl_repayments || !loan.kl_repayments.length) return
        loan.kl_repay_categories = loan.kl_repayments.select(payment => payment.display)
        loan.kl_repay_data       = loan.kl_repayments.select(payment => payment.amount)
        loan.kl_repay_percent    = loan.kl_repayments.select(payment => payment.percent)
    },
    produceConfig(loan){
        this.ensureRepaymentsGraph(loan)
        var result = {
            chart: {
                alignTicks: false,
                type: 'bar',
                animation: false,
                renderTo: 'graph_container'
            },
            title: {text: 'Repayments'},
            xAxis: {
                categories: loan.kl_repay_categories,
                title: {text: null}
            },
            yAxis: [{
                    min: 0,
                    dataLabels: {enabled: false},
                    labels: {overflow: 'justify'},
                    title: {text: 'USD'}
                },
                {
                    min: 0,
                    max: 100,
                    dataLabels: {enabled: false},
                    labels: {overflow: 'justify'},
                    title: {text: 'Percent'}
                }],
            tooltip: {
                valueDecimals: 2
            },
            plotOptions: {
                bar: {
                    dataLabels: {
                        enabled: true,
                        valueDecimals: 2,
                        format: '${y:.2f} USD'
                    }
                },
                area: {
                    marker: {enabled: false},
                    dataLabels: {
                        enabled: false,
                        valueDecimals: 0,
                        format: '{y:.0f}%'
                    }
                }
            },
            legend: {enabled: false},
            credits: {enabled: false},
            series: [{
                type: 'column',
                animation: false,
                zIndex: 6,
                name: 'Repayment',
                data: loan.kl_repay_data
            }, {
                type: 'area',
                animation: false,
                yAxis: 1,
                zIndex: 5,
                name: 'Percentage',
                data: loan.kl_repay_percent
            }]
        }

        return result
    },
    render(){
        let {loan, config} = this.state
        if (!loan.kl_repay_categories) return <div> </div>
        var height = Math.max(400, Math.min(loan.kl_repay_categories.length * 50, 1000))
        return <Col key="graph_container" lg={4} id='graph_container'>
            <Highcharts style={{height: `${height}px`}} config={config} />
            <dl className="dl-horizontal">
                <dt>Interval</dt><dd>{loan.terms.repayment_interval}</dd>
                <dt>{Math.round(loan.kls_half_back_actual)}% back by</dt><dd>{loan.kls_half_back.toString("MMM d, yyyy")}</dd>
                <dt>{Math.round(loan.kls_75_back_actual)}% back by</dt><dd>{loan.kls_75_back.toString("MMM d, yyyy")}</dd>
                <dt>Final repayment</dt><dd>{loan.kls_final_repayment.toString("MMM d, yyyy")}</dd>
            </dl>
        </Col>
    }
})

var Loan = React.createClass({
    mixins:[Reflux.ListenerMixin, History], //, ImmutableOptimizations(['params'])
    getInitialState(){
        var loan = kivaloans.getById(this.props.params.id)
        var ls = (loan)? this.loanToState(loan): {}
        var at = this.savedActiveTab()
        return extend({},at,ls)
    },
    componentWillUnmount(){
        clearInterval(this.refreshInterval)
        a.loans.selection(null)
    },
    componentDidMount(){
        this.listenTo(a.loans.detail.completed, this.displayLoan) //when loan gets refreshed or switched
        this.listenTo(a.loans.basket.changed, ()=>{ if (this.state.loan) this.setState({inBasket: s.loans.syncInBasket(this.state.loan.id)}) })
        this.listenTo(a.loans.load.completed, this.refreshLoan) //waits until page has finished loading... todo: if later make loader non-modal, change this.
        this.listenTo(a.loans.live.updated, this.displayLoan)
        this.listenTo(a.criteria.atheistListLoaded, x=> {
            this.figureAtheistDisplay()
            this.refreshLoan()
        })

        if (!this.state.loan) //if loan is displaying during initial load.
            kivaloans.getLoanFromKiva(this.props.params.id).done(this.displayLoan)

        this.refreshLoan() //happens always even if we have it, to cause a refresh.
        this.refreshInterval = setInterval(this.refreshLoan, 5*60000)  //every 5 minutes just for fun
        this.figureAtheistDisplay()
    },
    componentWillReceiveProps({params}){
        if (params.id != this.props.params.id)
            a.loans.detail(params.id)
    },
    savedActiveTab(){
        return {activeTab: (localStorage.loan_active_tab) ? parseInt(localStorage.loan_active_tab) : 1}
    },
    figureAtheistDisplay(){
        this.setState({showAtheistResearch: lsj.get("Options").mergeAtheistList && kivaloans.atheist_list_processed})
    },
    refreshLoan(){
        a.loans.detail(this.props.params.id)
    },
    loanToState(loan){
        var funded_perc = (loan.funded_amount * 100 /  loan.loan_amount)
        var basket_perc = (loan.basket_amount * 100 /  loan.loan_amount)
        var partner = loan.getPartner()
        //if (!partner) {
            //this is a hack... it only happens if your first page is a loan page and partners aren't downloaded yet.
            //there's surely a better way like getLoanFromKiva shouldn't return until partner download done.
            //kivaloans.partner_download.done(x=>this.displayLoan(loan))
        //}
        var pictured = loan.borrowers.where(b=>b.pictured).select(b=>`${b.first_name} (${b.gender})`).join(', ')
        var not_pictured = loan.borrowers.where(b=>!b.pictured).select(b=>`${b.first_name} (${b.gender})`).join(', ')
        var matching = s.criteria.syncGetMatchingCriteria(loan).join(', ') || '(none)'
        return {loan, matching, pictured, not_pictured, partner, basket_perc, funded_perc, similar: loan.kl_similar || [], inBasket: s.loans.syncInBasket(loan.id)}
    },
    displayLoan(loan){
        a.loans.selection(loan.id)
        if (loan.id != this.props.params.id) return

        window.currentLoan = loan
        var newState = this.loanToState(loan)

        //if we're already displaying this loan, only update the dyn fields
        if (this.state.loan && this.state.loan.id == loan.id) {
            this.setState(newState)
            return
        }

        if (!loan.kl_similar) {
            req.kiva.api.similarTo(loan.id)
                .done(similar => this.setState({similar: loan.kl_similar = similar.where(l=>l.id != loan.id)}))
                .fail(x=>this.setState({similar: loan.kl_similar = []}))
        }

        /**if (this.lastLookup != loan.id) {
            this.lastLookup = loan.id
            if (!loan.kl_repayments || !loan.description.texts.en)
                kivaloans.fetchDescrAndRepayments(loan).done(x=>a.loans.live.updated(loan))
        }**/

        newState.visionResults = null

        if (loan.kl_visionLabels && loan.kl_visionLabels.length)
            newState.visionResults = loan.kl_visionLabels.map(saw => `${saw.description} (${Math.round(saw.score * 100)}%)`).join(', ')
        else
            newState.visionResults = null

        if (loan.kl_faces){
            var faces = extend({},loan.kl_faces)
            Object.keys(faces).forEach(key => {
                if (faces[key] && Array.isArray(faces[key]) && faces[key].length == 0)
                    delete faces[key]
            })
            if (!Object.keys(faces).length) faces = null

            newState.visionFaces = []; //needs ; because of parenthesis
            (['joy','sorrow','anger','headwear']).forEach(key=>{
                if (faces && faces[key])
                    newState.visionFaces.push(`${key} (${faces[key].select(word=>humanize(word)).join(', ').toLowerCase()})`)
            })
        } else
            newState.visionFaces = null

        this.setState(newState)
    },
    tabSelect(activeTab){
        this.setState({activeTab})
        localStorage.loan_active_tab = activeTab
    },
    render() {
        let {loan, matching, partner, activeTab, visionFaces, inBasket, visionResults, funded_perc, basket_perc, pictured, not_pictured, showAtheistResearch, similar} = this.state
        if (!loan || !partner) return <Jumbotron style={{padding:'15px'}}><h1>Loading...</h1></Jumbotron> //only if looking at loan during initial load or one that isn't fundraising.
        var atheistScore = partner.atheistScore
        //this.renderCount = this.renderCount || 0
        //this.renderCount++

        if (!partner.social_performance_strengths) partner.social_performance_strengths = [] //happens other than old partners? todo: do a partner processor?
        return (
            <div className="Loan">
                <h1 style={{marginTop:'0px'}}>{loan.name}
                    <If condition={inBasket}>
                        <Button bsStyle="danger" className="float_right" onClick={a.loans.basket.remove.bind(this, loan.id)}>Remove from Basket</Button>
                    <Else/>
                        <Button bsStyle="success" className="float_right" disabled={loan.status!='fundraising'} onClick={a.loans.basket.add.bind(this, loan.id, 25)}>Add to Basket</Button>
                    </If>
                </h1>
                <Tabs activeKey={activeTab} animation={false} onSelect={this.tabSelect}>
                    <Tab eventKey={1} title="Image" className="ample-padding-top fullsizeImage">
                        <KivaImage key={loan.id} loan={loan} useThumbAsBackground={true} type="width" image_width={800} width="100%"/>
                        <Panel>
                            <If condition={loan.borrowers.length > 1}>
                                <p>In no particular order:</p>
                            </If>
                            <p>Pictured: {pictured ? pictured: '(none)'} </p>
                            <p>Not Pictured: {not_pictured ? not_pictured: '(none)'} </p>
                            <If condition={visionResults != null}>
                                <p>Google Cloud Vision describes the image (confidence level): {visionResults}</p>
                            </If>
                            <If condition={visionFaces != null && visionFaces.length}>
                                <p>
                                    Google found faces with the following: {visionFaces.map((found,key)=> <span key={key}>{found}{key < visionFaces.length-1? ', ':''}</span>)}
                                </p>
                            </If>
                        </Panel>
                    </Tab>
                    <Tab eventKey={2} title="Details" className="ample-padding-top">
                        <Grid fluid>
                            <Col lg={8}>
                                <DeadZone until={x=>funded_perc*(basket_perc+1)}>
                                    <ProgressBar>
                                        <ProgressBar striped bsStyle="success" now={funded_perc} key={1}/>
                                        <ProgressBar bsStyle="warning" now={basket_perc} key={2}/>
                                    </ProgressBar>
                                </DeadZone>
                                <Row>
                                    <b>{loan.location.country} | {loan.sector} | {loan.activity} | {loan.use}</b>
                                </Row>
                                <Row>
                                    <LoanLink loan={loan}>View on Kiva.org</LoanLink>
                                </Row>
                                <dl className="dl-horizontal">
                                    <dt>Saved Searches</dt><dd>{matching}</dd>
                                    <dt>Tags</dt><dd>{(loan.kls_tags.length)? loan.kls_tags.select(t=>humanize(t)).join(', '): '(none)'}</dd>
                                    <dt>Themes</dt><dd>{(loan.themes && loan.themes.length)? loan.themes.join(', '): '(none)'}</dd>
                                    <dt>Borrowers</dt><dd>{loan.borrowers.length} ({Math.round(loan.kl_percent_women)}% Female) </dd>
                                    <dt>Posted</dt><dd>{loan.kl_posted_date.toString('MMM d, yyyy @ h:mm:ss tt')} (<TimeAgo date={loan.posted_date} />)</dd>
                                    <If condition={loan.status != 'fundraising'}>
                                        <DTDD term='Status' def={humanize(loan.status)} />
                                    </If>
                                    <If condition={loan.funded_date}>
                                        <DTDD term='Funded' def={new Date(loan.funded_date).toString('MMM d, yyyy @ h:mm:ss tt')} />
                                    </If>
                                    <If condition={loan.status == 'fundraising'}>
                                        <span><dt>Expires</dt><dd>{loan.kl_planned_expiration_date.toString('MMM d, yyyy @ h:mm:ss tt')} (<TimeAgo date={loan.planned_expiration_date} />) </dd></span>
                                    </If>
                                    <dt>Disbursed</dt><dd>{new Date(loan.terms.disbursal_date).toString('MMM d, yyyy')} (<TimeAgo date={loan.terms.disbursal_date} />) </dd>
                                    <If condition={loan.status == 'fundraising'}>
                                        <span><dt>Final Repayment In</dt><dd>{numeral(loan.kls_repaid_in).format('0.0')} months</dd></span>
                                    </If>
                                </dl>
                                <If condition={loan.status == 'fundraising'}>
                                    <dl className="dl-horizontal">
                                        <dt>$/Hour</dt><dd>${numeral(loan.kl_dollars_per_hour()).format('0.00')}</dd>
                                        <dt>Loan Amount</dt><dd>${loan.loan_amount}</dd>
                                        <dt>Funded Amount</dt><dd>${loan.funded_amount}</dd>
                                        <dt>In Baskets</dt><dd>${loan.basket_amount}</dd>
                                        <dt>Still Needed</dt><dd>${loan.kl_still_needed}</dd>
                                    </dl>
                                </If>
                                <p dangerouslySetInnerHTML={{__html: loan.description.texts.en}} ></p>

                            </Col>
                            {(activeTab == 2 && loan.kl_repayments)? <RepaymentGraphs loan={loan}/> : <span/>}
                        </Grid>
                    </Tab>

                    <Tab eventKey={3} title="Partner" className="ample-padding-top">
                        <h2>{partner.name}</h2>
                        <Col lg={6}>
                        <dl className="dl-horizontal">
                            <dt>Rating</dt><dd>{partner.rating}</dd>
                            <dt>Start Date</dt><dd>{new Date(partner.start_date).toString("MMM d, yyyy")}</dd>
                            <dt>{partner.countries.length == 1 ? 'Country' : 'Countries'}</dt><dd>{partner.countries.select(c => c.name).join(', ')}</dd>
                            <dt>Delinquency</dt><dd>{numeral(partner.delinquency_rate).format('0.000')}% {partner.delinquency_rate_note}</dd>
                            <dt>Loans at Risk Rate</dt><dd>{numeral(partner.loans_at_risk_rate).format('0.000')}%</dd>
                            <dt>Default</dt><dd>{numeral(partner.default_rate).format('0.000')}% {partner.default_rate_note}</dd>
                            <dt>Total Raised</dt><dd>${numeral(partner.total_amount_raised).format('0,0')}</dd>
                            <dt>Loans</dt><dd>{numeral(partner.loans_posted).format('0,0')}</dd>
                            <dt>Portfolio Yield</dt><dd>{numeral(partner.portfolio_yield).format('0.0')}% {partner.portfolio_yield_note}</dd>
                            <dt>Profitablility</dt>
                            <If condition={partner.profitability}>
                                <dd>{numeral(partner.profitability).format('0.0')}%</dd>
                            <Else/>
                                <dd>(unknown)</dd>
                            </If>
                            <dt>Charges Fees / Interest</dt><dd>{partner.charges_fees_and_interest ? 'Yes': 'No'}</dd>
                            <dt>Avg Loan/Cap Income</dt><dd>{numeral(partner.average_loan_size_percent_per_capita_income).format('0.00')}%</dd>
                            <dt>Currency Ex Loss</dt><dd>{numeral(partner.currency_exchange_loss_rate).format('0.000')}%</dd>
                            <If condition={partner.url}>
                                <span><dt>Website</dt><dd><NewTabLink href={partner.url}>{partner.url}</NewTabLink></dd></span>
                            </If>
                        </dl>

                        </Col>
                        <Col lg={6}>
                            <If condition={partner.image}>
                                <KivaImage key={partner.id} className="float_left" type="width" loan={partner} image_width={800} width="100%"/>
                            </If>
                            <KivaLink path={`partners/${partner.id}`}>View Partner on Kiva.org</KivaLink>
                        </Col>
                        <Col lg={12}>
                            <If condition={partner.kl_sp.length}>
                                <div>
                                    <h3>Social Performance Strengths</h3>
                                    <ul>
                                        <For each="sp" index="i" of={partner.social_performance_strengths}>
                                            <li key={i}><b>{sp.name}</b>: {sp.description}</li>
                                        </For>
                                    </ul>
                                </div>
                            </If>

                            <If condition={showAtheistResearch && atheistScore}>
                                <div>
                                    <h3>Atheist Team Research</h3>
                                    <dl className="dl-horizontal">
                                        <dt>Secular Rating</dt><dd>{atheistScore.secularRating}</dd>
                                        <dt>Religious Affiliation</dt><dd>{atheistScore.religiousAffiliation}</dd>
                                        <dt>Comments on Rating</dt><dd>{atheistScore.commentsOnSecularRating}</dd>
                                        <dt>Social Rating</dt><dd>{atheistScore.socialRating}</dd>
                                        <dt>Comments on Rating</dt><dd>{atheistScore.commentsOnSocialRating}</dd>
                                        <dt>Review Comments</dt><dd>{atheistScore.reviewComments}</dd>
                                    </dl>
                                </div>
                            </If>
                        </Col>
                    </Tab>

                    <Tab eventKey={4} title="Similar" disabled={similar && similar.length == 0} className="ample-padding-top">
                        <Col lg={6}>
                            <InfiniteList
                                className="loan_list_container"
                                items={similar}
                                height={300}
                                itemHeight={100}
                                itemsCount={similar ? similar.length : 0}
                                listItemClass={LoanListItem} />
                        </Col>
                    </Tab>
                </Tabs>
            </div>
        )
    }
})

export default Loan